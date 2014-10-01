Distributed Real-time text editor with PubNub and Modulus Part 1.

I was faced with an interesting question: "How do I facilitate communication between servos on Modulus?". Since, each servo runs one instance of your application and each is completely isolated from one another, that's a great question. In some cases, we want our application to be aware of other instances of our application. For example, in your application you may want to start some sort of cron job. Like so: 

var http = require('http');
var later = require('later');

http.createServer(function (req, res) {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Hello World\n');
}).listen(1337, '127.0.0.1');
console.log('Server running at http://127.0.0.1:1337/');

// Using later.js
// will fire every 5 minutes
var textSched = later.parse.text('every 5 min');

// execute logTime for each successive occurrence of the text schedule
var timer = later.setInterval(logTime, textSched);

// function to execute
function logTime() {
  console.log(new Date());
}

With one instance, this is fine. But, what happens when I scale up to two instances of my application? Both, cron jobs will run. This can lead to undesired effects. Assuming this cron job should only run once, I need to facilitate some sort of communication between servos. 

PubNub is a extremely robust and easy to use Publish/Subscribe service. We can use it communicate between instances of our application so the cron jobs don
t step over each other. 

In your application, you can simply set up PubNub like so: 

var pubnub = require("pubnub").init({
    publish_key   : "PUBLISH_KEY",
    subscribe_key : "SUBSCRIBE_KEY"
});

Next we subscribe to a certain channel. We are going to call ours 'cron'. When a message gets published to the cron channel, that means anther servo is running the cron. So, we can cancel all other additional cron jobs on any additional servo.  

pubnub.subscribe({
    channel  : 'cron',
    callback : function(message) {
        timer.clear(); // Clear cron so It doesn't run on this servo
    }
});

Now, we can update our logTime function to send a message to the other servos so they can cancel their cron. 

function logTime() {
  pubnub.unsubscribe('cron'); // unsubscribe so I don't receive notifications. 
  pubnub.publish({ 
      channel   : 'servo',
      message   : { servoId : process.env.SERVO_ID }
  });
  console.log(new Date());
}

Now, servos are aware when one is running the cron job. This example is very simple. Lets do something more complicated. Lets create a real-time text editor. For the full code look at this github repo[LINK REPO]. Before we dive in, I have a few expectations for this application:

Infinitively scalable
  As new instances of my application get created, I need to make sure that the new instance is initialized properly. Also, when I scale down, it shouldn't break things as well. 
Fail over
  If any instance crashes for any reason. It should not affect the rest of the system.
Every instance is always up to date
  This is the real-time part of the text editor.
No Database
  This is not really an expectation just a cool thing to accomplish. :)


Lets talk about users.

We first need to keep track of users, make sure that all instance of my applications have that list of users, and lastly make sure new instances get initialize properly with all the current users. 

Lets start by making a users object. 

var users = {};

Users will be persisted like so:

{"anaptfox":"1","fiveisprime":"2"}

The key of each is the username and the value is the id of the servo they are currently connected to. Were gonna need the users current servo later on. We using an object instead of an array for quick look up. 

When my application starts, I want to ask any other instances on our 'state' PubNub channel for there list of users. Lets call this function init and call it when the server starts:

var init = function() {
  debug('Requesting state');
  // Lets tell the other servos I am live and that I want to be updated. 
  pubnub.publish({
    channel: 'state',
    message: {
      servoId: process.env.SERVO_ID
    }
  });
} 

....

var server = app.listen(app.get('port'), function() {
  debug('Express server listening on port ' + server.address().port);
  init();
});


Now, when new instances come on-line, they publish a message to the 'state' channel requesting the current state from all of the other instances. The other instance can now make a POST directly to the servo that requested state. Since were using Modulus, we can use the 'mod-servo' header to specify which servo we want to connect to. 

pubnub.subscribe({
  channel: 'state',
  callback: function(message) {
    debug('Got message on state channel: %s', JSON.stringify(message));
    
    // Don't send message to me
    if (message.servoId === process.env.SERVO_ID) return; 
    
    // This should be updated to your project url
    var url = 'http://my-project-12345.onmodulus.net/api/state';
    
    debug('Posting too: %s and sending %s', url, JSON.stringify(users));
    
    request.post(url, {
      headers: {
        'mod-servo': message.servoId
      }
    }).form({
      data: JSON.stringify(users)
    });
  }
});

Now we can set up a POST handler so that the servo that requested state can be properly updated:

app.post('/api/state', function(req, res) {
  body = JSON.parse(req.body.data);
  
  debug('Updating state with: %s', JSON.stringify(body));
  
  users = _.merge(users, body);
  
  res.status(200).end();
  
  debug('State updated to: %s', JSON.stringify(users))
});

Now, any time a new application is come online, they will be updated with the current state of users. Also, if one instance crashes, it will be automatically restarted with Modulus. Then once restarted, it will request it's state back from another servo. Not to shabby. 

Now, we need to be able to add and remove users. We want each servo to listen for these events and update there list accordingly. 

pubnub.subscribe({
  channel: 'new-user',
  callback: function(message) {
    debug('Got message on new-user channel: %s', JSON.stringify(message));
    
    users[message.user] = message.servoId;
    
    debug('Added new user to my list,  %s , for servo %s', message.user, 
    message.servoId);
    
    debug('State updated to: %s', JSON.stringify(users))
  }
});

pubnub.subscribe({
  channel: 'drop-user',
  callback: function(message) { 
    debug('Got message on new-user channel: %s', JSON.stringify(message));
    
    delete users[message.user];
    
    debug('Removed user from my list,  %s , for servo %s', message.user, 
    message.servoId);
    
    debug('State updated to: %s', JSON.stringify(users))
  }
});

app.post('/api/user/new', function(req, res) {
  debug('Adding user: %s', JSON.stringify(req.body));
  pubnub.publish({
    channel: 'new-user',
    message: {
      user: req.body.user,
      servoId: process.env.SERVO_ID
    }
  });
  res.status(200).end();
});

app.post('/api/user/drop', function(req, res) {
  debug('Removing user: %s', JSON.stringify(req.body));
  pubnub.publish({
    channel: 'drop-user',
    message: {
      user: req.body.user,
      servoId: process.env.SERVO_ID
    }
  });
  res.status(200).end();
});

Now, as users come online and drop off, my entire application is aware. Also, as I scale up/down or a servo crashes nothing will break. It's scaleable, real-time, and using no database all with the power of PubNub.

In Part 2 of this article we will build upon this user system we created to start implementing the front end and text editor. 

