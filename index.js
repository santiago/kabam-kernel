var EventEmitter = require('events').EventEmitter,
  path = require('path'),
  url = require('url'),
  async = require('async'),
  util = require('util'),
  http = require('http'),
  https = require('https'),
  appManager = require('./lib/appManager.js'),
  mongooseManager = require('./lib/mongooseManager.js'),
  redisManager = require('./lib/redisManager.js'),
  toobusy = require('toobusy');

function MWC(config) {

  EventEmitter.call(this);

  this.validateConfig(config);
  this.config = config;
  this.extendCoreFunctions = [];
  this.additionalModels = [];
  this.extendAppFunctions = [];
  this.extendMiddlewaresFunctions = [];
  this.extendRoutesFunctions = [];

  return this;
}

util.inherits(MWC, EventEmitter);

MWC.prototype.validateConfig = function(config) {
  // General check
  if (typeof config !== 'object') {
    throw new Error('Config is not an object!');
  }
  if (!(config.hostUrl && url.parse(config.hostUrl)['hostname'])) {
    throw new Error('Config.hostUrl have to be valid hostname - for example, http://example.org/ with http(s) on start and "/" at end!!!');
  }
  if (!(config.secret && config.secret.length>9)) {
    throw new Error('Config.secret is not set or is to short!');
  }

  mongooseManager.validateConfig(config.mongoUrl);
  redisManager.validateConfig(config.redis);

  return true;
};

//extending application
MWC.prototype.extendCore = function (settingsFunction) {
  if (this.prepared) {
    throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
  } else {
    if (typeof settingsFunction === 'function') {
      this.extendCoreFunctions.push(settingsFunction);
      return this;
    } else {
      throw new Error('MWC.extendCore requires argument of function(core){...}');
    }
  }
};

MWC.prototype.extendModel = function (modelName, modelFunction) {
  if (modelName === 'Users') {
    throw new Error('Error extending model, "Users" is reserved name');
  } else {
    if (typeof modelName === 'string' && typeof modelFunction === 'function') {
      this.additionalModels.push({'name': modelName, 'initFunction': modelFunction});
      return this;
    } else {
      throw new Error('MWC.extendModel requires arguments of string of "modelName" and function(core){...}');
    }
  }
};

MWC.prototype.extendApp = function (environment, settingsFunction) {
  if (this.prepared) {
    throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
  } else {
    var environmentToUse = null;
    if (typeof settingsFunction === 'undefined') {
      settingsFunction = environment;
      environment = null;
    }
    if (typeof environment === 'string') {
      environmentToUse = [];
      environmentToUse.push(environment);
    }
    if (environment instanceof Array) {
      environmentToUse = environment;
      for (var i = 0; i < environment.length;i++){
        if(typeof environment[i] !== 'string'){
          throw new Error('#MWC.extendApp requires environment name to be a string!');
        }
      }
    }
    if (typeof settingsFunction === 'function') {
      if (environmentToUse) {
        for (var i = 0; i < environmentToUse.length; i++) {
          this.extendAppFunctions.push({
            'environment': environmentToUse[i],
            'settingsFunction': settingsFunction
          });
        }
      } else {
        this.extendAppFunctions.push({
          'settingsFunction': settingsFunction
        });
      }
    } else {
      throw new Error('Wrong arguments for extendApp(arrayOrStringOfEnvironments,settingsFunction)');
    }
    return this;
  }
};

MWC.prototype.extendMiddlewares = function (environment, path, settingsFunction) {
  if (this.prepared) {
    throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
  } else {
    var environmentToUse = null,
      pathToUse = '/',
      settingsFunctionToUse = null;

    if (typeof environment === 'function' && typeof path === 'undefined' && typeof settingsFunction === 'undefined') {
      settingsFunctionToUse = environment;
    }

    if (typeof environment === 'string' || environment instanceof Array) {

      if (typeof environment === 'string') {
        environmentToUse = [];
        environmentToUse.push(environment);
      }
      if (environment instanceof Array) {
        environmentToUse = environment;
        for (var i = 0; i < environment.length;i++){
          if(typeof environment[i] !== 'string'){
            throw new Error('#MWC.extendMiddlewares requires environment name to be a string!');
          }
        }
      }
      if (typeof path === 'string') {
        if(/^\//.test(path)){
          pathToUse = path;
          if (typeof settingsFunction === 'function') {
            settingsFunctionToUse = settingsFunction;
          }
        } else {
          throw new Error('#MWC.extendMiddlewares path to be a middleware valid path, that starts from "/"!');
        }
      } else {
        if (typeof path === 'function') {
          settingsFunctionToUse = path;
        }
      }
    }

    if (settingsFunctionToUse) {
      if (environmentToUse) {
        for (var i = 0; i < environmentToUse.length; i++) {
          this.extendMiddlewaresFunctions.push({
            'environment': environmentToUse[i],
            'path': pathToUse,
            'SettingsFunction': settingsFunctionToUse
          });
        }
      } else {
        //we set middleware for all environments
        this.extendMiddlewaresFunctions.push({
          'path': pathToUse,
          'SettingsFunction': settingsFunctionToUse
        });
      }
    } else {
      throw new Error('Wrong arguments for function MWC.extendMiddlewares(environmentArrayOrStrings, [path], settingsFunction(core){...})');
    }
    return this;
  }
};

MWC.prototype.extendRoutes = function (settingsFunction) {
  if (this.prepared) {
    throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
  } else {
    if (typeof settingsFunction === 'function') {
      this.extendRoutesFunctions.push(settingsFunction);
      return this;
    } else {
      throw new Error('Wrong argument for MWC.extendAppRoutes(function(core){...});');
    }
  }
};

MWC.prototype.usePlugin = function (pluginObjectOrName) {
  if (this.prepared) {
    throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
  } else {
    var pluginToBeInstalled = {};
    if (typeof pluginObjectOrName === 'string') {
      pluginToBeInstalled = require('' + pluginObjectOrName);
    } else {
      pluginToBeInstalled = pluginObjectOrName;
    }

    if (pluginToBeInstalled.extendCore) {
      this.extendCore(pluginToBeInstalled.extendCore);
    }
    if (pluginToBeInstalled.extendModel && typeof pluginToBeInstalled.extendModel === 'object') {
      for (var x in pluginToBeInstalled.extendModel) {
        this.extendModel(x, pluginObjectOrName.extendModel[x]);
      }
    }
    if(pluginToBeInstalled.setAppParameters && typeof pluginToBeInstalled.extendApp === 'undefined'){
      console.log('Plugin is outdated! Use extendApp instead of setAppParameters with same syntax!');
      pluginToBeInstalled.extendApp=pluginToBeInstalled.setAppParameters;
    }
    if (pluginToBeInstalled.extendApp) {
      this.extendApp(pluginToBeInstalled.extendApp);
    }
    if(pluginToBeInstalled.setAppMiddlewares && typeof pluginToBeInstalled.extendMiddlewares === 'undefined'){
      console.log('Plugin is outdated! Use extendMiddlewares instead of setAppMiddlewares with same syntax!');
      pluginToBeInstalled.extendMiddlewares=pluginToBeInstalled.setAppMiddlewares;
    }
    if (pluginToBeInstalled.extendMiddlewares) {
      this.extendMiddlewares(pluginToBeInstalled.extendMiddlewares);
    }
    if(pluginToBeInstalled.extendAppRoutes && typeof pluginToBeInstalled.extendRoutes === 'undefined'){
      console.log('Plugin is outdated! Use extendMiddlewares instead of setAppMiddlewares with same syntax!');
      pluginToBeInstalled.extendRoutes=pluginToBeInstalled.extendAppRoutes;
    }
    if (pluginToBeInstalled.extendRoutes) {
      this.extendRoutes(pluginToBeInstalled.extendRoutes);
    }
    return this;
  }
};

MWC.prototype.ready = function () {
  var thisMWC = this;//because we sometimes issue closures with thisMWC
  thisMWC.prepared = true;

  //injecting redis
  thisMWC.redisClient = redisManager.create(thisMWC.config.redis);

  // initializing MongoDB and Core Models
  thisMWC.mongoose = mongooseManager.create(thisMWC.config.mongoUrl);
  thisMWC.mongoose.setConnectEvent(thisMWC);
  thisMWC.model = mongooseManager.initModels(thisMWC);

  //doing extendCore
  //extending core by extendCore
  thisMWC.extendCoreFunctions.map(function (settingsFunction) {
    settingsFunction(thisMWC);
  });

  //loading custom models //todo - maybe redo
  thisMWC.additionalModels.map(function (customModel) {
    thisMWC.model[customModel.name] = customModel.initFunction(thisMWC.mongoose, thisMWC.config);
  });

  //initialize expressJS application
  thisMWC.app = appManager.create(thisMWC.config, thisMWC);
  appManager.extendApp(thisMWC);

  // set shutdown procedure
  process.on('SIGINT', thisMWC.shutdown);

  return thisMWC;
};

MWC.prototype.listen = function (httpOrHttpsOrPort) {

  if (!this.prepared) {
    this.ready();
  }

  if (httpOrHttpsOrPort) {
    if (typeof httpOrHttpsOrPort === 'number' && httpOrHttpsOrPort > 0) {
      this.app.listen(httpOrHttpsOrPort);
      return;
    }

    if (httpOrHttpsOrPort instanceof http || httpOrHttpsOrPort instanceof https) {
      httpOrHttpsOrPort.createServer(this.app).listen(this.app.get('port'));
      return;
    }
    throw new Error('Function MWC.listen(httpOrHttpsOrPort) accepts objects of null, http, https or port\'s number as argument!');
  } else {
    this.app.listen(this.app.get('port'));//listening to default port
  }
};

MWC.prototype.setAppParameters = function(environment, settingsFunction){
  console.log('setAppParameters is outdated, use extendApp  with the same syntax');
  this.extendApp(environment, settingsFunction);
  return this;
};

MWC.prototype.setAppMiddlewares = function(environment, path, settingsFunction){
  console.log('setAppMiddlewares is outdated, use extendMiddlewares with the same syntax');
  this.extendMiddlewares(environment, path, settingsFunction);
  return this;
};

MWC.prototype.extendAppRoutes = function(settingsFunction){
  console.log('extendAppRoutes is outdated, use extendRoutes with the same syntax');
  this.extendRoutes(settingsFunction);
  return this;
};

MWC.prototype.shutdown = function () {

  console.log('MWC IS GOING TO SHUT DOWN....');
  this.mongoose.connection.close();
  this.redisClient.end();
  // calling .shutdown allows your process to exit normally
  toobusy.shutdown();
  process.exit();

};

MWC.prototype.injectEmit = function(object) {
  var thisMWC = this;
  object.emitMWC = function (eventName, eventContent) {
    thisMWC.emit(eventName, eventContent);
  };
};

MWC.create = function(config){
  return new MWC(config);
};

module.exports = exports = MWC.create;
