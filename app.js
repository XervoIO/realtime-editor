var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var request = require('request');
var _ = require('lodash');
var debug = require('debug')('server');

var users = {};

var pubnub = require('pubnub').init({
  publish_key: '',
  subscribe_key: ''
});

var init = function() {
  debug('Requesting state');
  // Lets tell the other servos Im live and that I want to be updated. 
  pubnub.publish({
    channel: 'state',
    message: {
      servoId: process.env.SERVO_ID
    }
  });
}


pubnub.subscribe({
  channel: 'state',
  callback: function(message) {
    debug('Got message on state channel: %s', JSON.stringify(message));
    if (message.servoId === process.env.SERVO_ID) return; // Don't send message to me
    var url = 'http://pubnub-12345.onmodulus.net/api/state';
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

pubnub.subscribe({
  channel: 'new-user',
  callback: function(message) {
    debug('Got message on new-user channel: %s', JSON.stringify(message));
    users[message.user] = message.servoId;
    debug('Added new user to my list,  %s , for servo %s', message.user, message.servoId);
    debug('State updated to: %s', JSON.stringify(users))
  }
});

pubnub.subscribe({
  channel: 'drop-user',
  callback: function(message) {
    debug('Got message on new-user channel: %s', JSON.stringify(message));
    delete users[message.user];
    debug('Removed user from my list,  %s , for servo %s', message.user, message.servoId);
    debug('State updated to: %s', JSON.stringify(users))
  }
});

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/state', function(req, res) {
  body = JSON.parse(req.body.data);
  debug('Updating state with: %s', JSON.stringify(body));
  users = _.merge(users, body);
  res.status(200).end();
  debug('State updated to: %s', JSON.stringify(users))
});

app.post('/api/user/new', function(req, res) {
  debug('Updating user: %s', JSON.stringify(req.body));
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
  debug('Updating user: %s', JSON.stringify(req.body));
  pubnub.publish({
    channel: 'drop-user',
    message: {
      user: req.body.user,
      servoId: process.env.SERVO_ID
    }
  });
  res.status(200).end();
});

app.set('port', process.env.PORT || (5555 + process.env.SERVO_ID));

var server = app.listen(app.get('port'), function() {
  debug('Express server listening on port ' + server.address().port);
  init();
});