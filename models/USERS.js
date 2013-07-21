var async = require('async'),
  hat = require('hat'),
  rack = hat.rack(),
  crypto = require('crypto'),
  moment = require('moment');


function md5(str) {
  return crypto.createHash('sha512').update(str).digest('hex').toString(); //Anatolij - lolz!!!)))
}

module.exports = exports = function (mongoose, config) {
  var Schema = mongoose.Schema;
  var UserSchema = new Schema({
    active: Boolean,
    activeDate: Date,
    accounts: [
      {
        provider: String,
        id: String,
        displayName: String,
        name: {
          familyName: String,
          givenName: String,
          middleName: String
        },
        emails: [
          {
            value: String,
            type: {
              type: String
            }
          }
        ],
        phoneNumbers: [
          {
            value: String,
            type: {
              type: String
            }
          }
        ],
        photos: [
          {
            value: String
          }
        ]
      }
    ],
    confirmation: {
      string: String,
      date: Date
    },
    username: String,
    email: String,

    cookieKey:String,//for invalidating sessions by user request

    salt: String,
    password: String,
    groups: [Number]
  });

  UserSchema.index({
    email: 1,
    username: 1
  });

  UserSchema.methods.generateConfirmationLink = function (callback) {
    this.confirmation.string = rack();
    this.confirmation.date = new Date();
    this.save(callback);
    return;
  };

  UserSchema.methods.activateUser = function (confirmationString, callback) {
    var err;
    if (typeof confirmationString !== 'undefined') {
      if (confirmationString !== this.confirmation.string) {
        err = new Error('Confirmation Strings don\'t match');
        callback(err);
      }
      var originalDate = moment(this.confirmation.date),
        now = moment(),
        expired = (typeof config.confirmationLinkExpire === 'undefined') ? 1 :
          config.confirmationLinkExpire;

      if (now.isAfter(originalDate.add('hours', expired))) {
        err = new Error('The link has expired.');
        callback(err);
      }
    }
    this.confirmation = null;
    this.activeDate = new Date();
    this.active = true;
    this.save(callback);
    return;
  };

  UserSchema.methods.verifyPassword = function (password) {
    return md5(''+this.salt + password) === this.password;
  };

  UserSchema.methods.setPassword = function(newPassword,callback){
    var salt = md5(rack());
    this.salt = salt;
    this.password=md5(''+salt+newPassword);
    this.save(callback);
    return;
  };

  User.Schema.methods.invalidateSession = function(callback){
    this.cookieKey=rack();
    this.save(callback);
    return;
  }

  return mongoose.model('users', UserSchema);
};