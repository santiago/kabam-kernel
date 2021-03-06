'use strict';
var EventEmitter = require('events').EventEmitter,
  url = require('url'),
  util = require('util'),
  appManager = require('./lib/appManager.js'),
  MongooseManager = require('./lib/MongooseManager.js'),
  configManager = require('./lib/configManager.js'),
  mongooseManager = new MongooseManager(),
  redisManager = require('./lib/redisManager.js'),
  colors = require('colors');

/**
 * @ngdoc function
 * @name kabamKernel
 * @constructor
 * @param {object} config - config object
 */
function KabamKernel(config) {
  EventEmitter.call(this);
  if (config === undefined) {
    config = {};
  }
  if (typeof config !== 'object') {
    throw new Error('Config is not an object!');
  }
  if (typeof config === 'object') {
    config.secret = configManager.getSecret(config.secret);
    config.hostUrl = configManager.getHostUrl(config.hostUrl);
    config.redis = configManager.getRedisUrl(config.redis);
    config.mongoUrl = configManager.getMongoUrl(config.mongoUrl);
  }
  this.validateConfig(config);
  this.config = config;

  var extendCoreFunctions = [],//privileged field
    extendAppFunctions = [],
    additionalModels = [],
    additionalStrategies = [],
    prepared = false,
    extendMiddlewareFunctions = [],
    extendRoutesFunctions = [],
    catchAllFunction,
    thisMWC = this;//http://www.crockford.com/javascript/private.html

  //privileged functions
  /**
   * @ngdoc function
   * @name kabamKernel.extendCore
   * @description
   * Perform dependency injection on the mwc.shared object.
   * If mwc do not have fieldName property/method, this method is created as public property/method.
   * You can call this function multiple times. Later this field/method can be called by `mwc.nameSpaceName.fieldName`. `nameSpaceName`
   * can be ommited, default value is `shared`
   * @param {string} fieldName - field name
   * @param {function/object/string/number/array} factoryFunctionOrObject  function(config),
   * what is called to return value assigned to fieldName  config is the mwc.config object, or just a object, to be setted as mwc public field
   * @param {string} namespace  namespace to bind this field. default is 'shared;
   * @example
   * ```javascript
   *
   *     mwc.extendCore('checkSecret',function(config){
   *       return function(secretToCheck){
   *         return secretToCheck === config.secret;
   *       };
   *     };
   *
   *     mwc.extendCore('someVar',42);
   *     mwc.extendCore('someArray',[1,2,3]);
   *     mwc.extendCore('someObj',{ 'someVal':1});
   *     mwc.extendCore('a',333,'inThatNamespace');
   *
   *     mwc.start('app');
   *
   *     console.log(mwc.shared.checkSecret('someThing'); //false
   *     console.log(mwc.shared.someVar); //42
   *     console.log(mwc.shared.someArray); //[1,2,3]
   *     console.log(mwc.shared.someObj); //{ 'someVal':1}
   *     console.log(mwc.inThatNamespace.a); //333
   *
   *  ```
   * @returns {kabamKernel} kabamKernel object
   */
  this.extendCore = function (fieldName, factoryFunctionOrObject, namespace) {
    if (prepared) {
      throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
    } else {
      if (!namespace) {
        namespace = 'shared';
      }

      if (typeof fieldName === 'string' && factoryFunctionOrObject !== undefined) {
        if (typeof factoryFunctionOrObject === 'function') {
          extendCoreFunctions.push({'field': fieldName, 'factoryFunction': factoryFunctionOrObject, 'namespace': namespace});
        } else {
          extendCoreFunctions.push({'field': fieldName, 'factoryFunction': function () {
            return factoryFunctionOrObject;
          }, 'namespace': namespace});
        }
      } else {
        throw new Error('KabamKernel.extendCore requires argument of fieldName(string), and value - function(config){} or object!');
      }
      return this;
    }
  };

  /**
   * @ngdoc function
   * @name kabamKernel.extendModel
   * @description
   * Perform dependency injection of mongoose models to mwc.model and request.model.
   * When you call `extendModel(modelName,function(kabamKernel){...})` you get all the environment created after calling
   * `extendCore(function(core){...})`.
   * @param {string} modelName - field name, "Users" is reserved field name!
   * @param {function} modelFunction - function(kabamKernel) - the first argument is mongoose object, the second one is the
   * mwc.config object
   * @example
   * ```javascript
   *
   *     KabamKernel.extendModel('Cats', function (kabam) {
   *        var CatsSchema = new kabam.mongoose.Schema({
   *         'nickname': String
   *        });
   *
   *       return kabam.mongoConnection.model('cats', CatsSchema);
   *     });
   *
   * ```
   * @returns {kabamKernel} kabamKernel object
   */
  this.extendModel = function (modelName, modelFunction) {
    if (prepared) {
      throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
    } else {
      if (modelName === 'Users' || modelName === 'User' || modelName === 'Message' || modelName === 'Messages') {
        throw new Error('Error extending model, "User(s)" and "Message(s)" are reserved name');
      } else {
        if (typeof modelName === 'string' && typeof modelFunction === 'function') {
          additionalModels.push({'name': modelName, 'initFunction': modelFunction});
        } else {
          throw new Error('KabamKernel.extendModel requires arguments of string of "modelName" and function(core){...}');
        }
      }
      return this;
    }
  };

  /**
   * @ngdoc function
   * @name kabamKernel.extendStrategy
   * @description
   * Loads new passportjs strategies from object
   * @param {object} strategyObject Passport's strategy object
   * @returns {kabamKernel} kabamKernel object
   * @url https://github.com/mywebclass/mwc_kernel/blob/master/lib/strategies/github.js
   * @example
   * ```javascript
   *
   * mwc.extendStrategy({
   * 'strategy':function (core) {
   * return new LinkedInStrategy({
   *    consumerKey: core.config.passport.LINKEDIN_API_KEY,
   *    consumerSecret: core.config.passport.LINKEDIN_SECRET_KEY,
   *    callbackURL: core.config.hostUrl + 'auth/linkedin/callback'
   *    }, function (token, tokenSecret, profile, done) {
   *       var email = profile.emails[0].value;
   *      if (email) {
   *        core.model.Users.processOAuthProfile(email,done);
   *      } else {
   *        return done(new Error('There is something strange instead of user profile'));
   *      }
   *  });
   * },
   * 'routes':function (passport, core) {
   *     core.app.get('/auth/linkedin', passport.authenticate('linkedin'),
   *        function (req, res) {
   *
   *     });
   *     core.app.get('/auth/linkedin/callback', passport.authenticate('linkedin', { failureRedirect: '/' }),
   *       function (req, res) {
   *         res.redirect('/');
   *       });
   *     };
   *  });
   * ```
   */
  this.extendStrategy = function (strategyObject) {
    if (prepared) {
      throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
    } else {
      if (typeof strategyObject !== 'object') {
        throw new Error('mwc.extendStrategies requires strategyObject to be an object');
      }
      if (typeof strategyObject.strategy !== 'function') {
        throw new Error('mwc.extendStrategies requires strategyObject.strategy to be a proper function!');
      }
      if (typeof strategyObject.routes !== 'function') {
        throw new Error('mwc.extendStrategies requires strategyObject.routes to be a proper function!');
      }
      additionalStrategies.push(strategyObject);
      return this;
    }
  };

  /**
   * @ngdoc function
   * @name kabamKernel.extendApp
   * @description
   * Set app parameters - view engine, variables, locals
   * When you call `extendApp(function(core){...})`, you can set global application parameters, for example
   * template [engines](http://expressjs.com/api.html#app.engine), [locals](http://expressjs.com/api.html#app.locals)
   * and [other](http://expressjs.com/api.html#app-settings) settings.
   * In code it is called [after setting logging middleware and port](https://github.com/mywebclass/mwc_kernel/blob/master/lib/appManager.js#84).
   * You can set any application parameter you want, you have full MWC core internals at your disposal
   * `mwc.emit`,`mwc.on`, `mwc.redisClient`, and `mwc.model.User` and custom models from calling `extendModel`.
   * Some example of setting up the [template engine](https://github.com/mywebclass/mwc_plugin_hogan_express/blob/master/index.js)
   * via plugin.
   *
   * @param {string/array/undefined} environment - application environment to use,
   * can be something like 'development', ['development','staging'] or null
   *
   * @param {function} settingsFunction - function(core){....}
   * @example
   *
   * ```javascript
   *
   *     mwc.extendApp('development',function(core){
   *       core.app.locals.environment = 'development';
   *     });
   *     //example of setting template engine
   *     mwc.extendApp.app = function (core) {
   *       core.app.set('views', '/views');
   *       core.app.set('view engine', 'html');
   *       core.app.set('layout', 'layout');
   *       core.app.enable('view cache');
   *       core.app.engine('html', require('hogan-express'));
   *     };
   * ```
   *
   * @returns {kabamKernel} kabamKernel object
   */
  this.extendApp = function (environment, settingsFunction) {
    if (prepared) {
      throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
    } else {
      var environmentToUse = null,
        i,
        j;
      if (settingsFunction === undefined) {
        settingsFunction = environment;
        environment = null;
      }
      if (typeof environment === 'string') {
        environmentToUse = [];
        environmentToUse.push(environment);
      }
      if (environment instanceof Array) {
        environmentToUse = environment;
        for (i = 0; i < environment.length; i = i + 1) {
          if (typeof environment[i] !== 'string') {
            throw new Error('KabamKernel.extendApp requires environment name to be a string!');
          }
        }
      }
      if (typeof settingsFunction === 'function') {
        if (environmentToUse) {
          for (j = 0; j < environmentToUse.length; j = j + 1) {
            extendAppFunctions.push({
              'environment': environmentToUse[j],
              'settingsFunction': settingsFunction
            });
          }
        } else {
          extendAppFunctions.push({
            'settingsFunction': settingsFunction
          });
        }
      } else {
        throw new Error('Wrong arguments for extendApp(arrayOrStringOfEnvironments,settingsFunction)');
      }
      return this;
    }
  };

  /**
   * @ngdoc function
   * @name kabamKernel.extendMiddleware
   * @description
   * Adds new middleware to expressJS application
   * This function can be executed multiple times, the middlewares applied are used in application in *order* they were issued by this function.
   * First argument (array of enviroments), and the second one (the path where to use middleware, the default is "/") are OPTIONAL
   * They are [applied]((https://github.com/mywebclass/mwc_kernel/blob/master/index.js#L283) after
   * [setting default exposed internals middleware](https://github.com/mywebclass/mwc_kernel/blob/master/lib/appManager.js#L114) and before
   * [setting router middleware](https://github.com/mywebclass/mwc_kernel/blob/master/lib/appManager.js#L142).
   * So, you have the full power of core internals - (`emit`,`on`), `redisClient`, `model.User`
   * and exposed internals middleware - where expressJS object of request have functions of `request.mwcEmit`,
   * `request.model`,`request.model.User`, `request.emitMWC`, custom models,`request.redisClient`, and `request.user` provided
   * by passportjs middleware.
   * @param {string/array/undefined} environment - application enviroment to use,
   * can be something like 'development', ['development','staging'] or null (for ALL enviroments)
   * @param {string/undefined} path path to mount middleware - default is /
   * @param {function} settingsFunction function(core){ return function(req,res,next){.....}}
   * @example
   * ```javascript
   *
   *     mwc.extendMiddleware('production',function(core){
   *       return function(req,res,next){
   *         res.setHeader('X-production','YES!');
   *       };
   *     }
   *
   * ```
   * @returns {kabamKernel} kabamKernel object
   */
  this.extendMiddleware = function (environment, path, settingsFunction) {
    if (prepared) {
      throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
    } else {
      var environmentToUse = null,
        pathToUse = '/',
        settingsFunctionToUse = null,
        k,
        l;

      if (typeof environment === 'function' && path === undefined && settingsFunction === undefined) {
        settingsFunctionToUse = environment;
      }

      if (typeof environment === 'string' || environment instanceof Array) {

        if (typeof environment === 'string') {
          environmentToUse = [];
          environmentToUse.push(environment);
        }
        if (environment instanceof Array) {
          environmentToUse = environment;
          for (k = 0; k < environment.length; k = k + 1) {
            if (typeof environment[k] !== 'string') {
              throw new Error('KabamKernel.extendMiddleware requires environment name to be a string!');
            }
          }
        }
        if (typeof path === 'string') {
          if (/^\//.test(path)) {
            pathToUse = path;
            if (typeof settingsFunction === 'function') {
              settingsFunctionToUse = settingsFunction;
            }
          } else {
            throw new Error('KabamKernel.extendMiddleware path to be a middleware valid path, that starts from "/"!');
          }
        } else {
          if (typeof path === 'function') {
            settingsFunctionToUse = path;
          }
        }
      }

      if (settingsFunctionToUse) {
        if (environmentToUse) {
          for (l = 0; l < environmentToUse.length; l = l + 1) {
            extendMiddlewareFunctions.push({
              'environment': environmentToUse[l],
              'path': pathToUse,
              'SettingsFunction': settingsFunctionToUse
            });
          }
        } else {
          //we set middleware for all environments
          extendMiddlewareFunctions.push({
            'path': pathToUse,
            'SettingsFunction': settingsFunctionToUse
          });
        }
      } else {
        throw new Error('Wrong arguments for function KabamKernel.extendMiddleware(environmentArrayOrStrings, [path], settingsFunction(core){...})');
      }
      return this;
    }
  };

  /**
   * @ngdoc function
   * @name kabamKernel.extendRoutes
   * @description
   * Adds application routes and verbs for them.
   * ExpressJS object of every routes request have functions of `request.mwcEmit`,
   * `request.model`,`request.model.User`, `request.emitMWC`, custom models,`request.redisClient`, and `request.user` provided
   * by [passportjs](http://passportjs.org) middleware.
   * @param {function} settingsFunction Settings Function
   * @example
   * ```javascript
   *
   *     mwc.extendRoutes(function(core){
   *       core.app.get('/', function(req,res){
   *         res.send('Hello!');
   *       });
   *     }
   * ```
   * @returns {kabamKernel} kabamKernel object
   */
  this.extendRoutes = function (settingsFunction) {
    if (prepared) {
      throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
    } else {
      if (typeof settingsFunction === 'function') {
        extendRoutesFunctions.push(settingsFunction);
      } else {
        throw new Error('Wrong argument for KabamKernel.extendAppRoutes(function(core){...});');
      }
      return this;
    }
  };

  /**
   * @ngdoc function
   * @name kabamKernel.catchAll
   * @description
   * Provides ability to add a "catch all" callback function that will be called only if no
   * middleware returned a response nor any route have been matched.
   * @param {function} catchAllFunction callback function
   * @example
   * ```javascript
   *
   *     kernel.catchAll(function(kernel){
   *       return function(req, res){
   *         res.send(404);
   *       }
   *     });
   * ```
   */
  this.catchAll = function (func) {
    if (prepared) {
      throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
    }
    if (typeof func !== 'function') {
      throw new Error('Wrong argument for KabamKernel.catchAll(function(kernel){...});');
    }
    catchAllFunction = func;
  };

  /**
   * @ngdoc function
   * @name kabamKernel.usePlugin
   * @description
   * Loads plugin from object or npm module
   * @param {object/string} pluginObjectOrName - config object or plugin name to get by require
   * @url https://github.com/mywebclass/mwc_kernel/blob/master/example/plugin.example.js
   */
  this.usePlugin = function (pluginObjectOrName) {
    if (prepared) {
      throw new Error('MWC core application is already prepared! WE CAN\'T EXTEND IT NOW!');
    } else {
      var pluginToBeInstalled = {},
        field,
        i,
        y,
        x;
      if (typeof pluginObjectOrName === 'string') {
        pluginToBeInstalled = require(pluginObjectOrName);
      } else {
        pluginToBeInstalled = pluginObjectOrName;
      }

      if (typeof pluginToBeInstalled.name !== 'string' && !/^[a-z0-9_\-]+$/.test(pluginToBeInstalled.name) && pluginObjectOrName.name === 'shared') {
        throw new Error('Wrong plugin syntax. Plugin name is missed or have wrong syntax!');
      }

      if (typeof pluginToBeInstalled.core === 'object') {
        for (field in pluginToBeInstalled.core) {
          if (pluginToBeInstalled.core.hasOwnProperty(field)) {
            this.extendCore(field, pluginToBeInstalled.core[field], pluginToBeInstalled.name);
          }
        }
      }
      if (typeof pluginToBeInstalled.model === 'object') {
        for (x in pluginToBeInstalled.model) {
          if (pluginToBeInstalled.model.hasOwnProperty(x)) {
            this.extendModel(x, pluginToBeInstalled.model[x]);
          }
        }
      }

      if (typeof pluginToBeInstalled.strategy === 'object') {
        if (typeof pluginToBeInstalled.strategy.strategy === 'function' && typeof pluginToBeInstalled.strategy.routes === 'function') {
          this.extendStrategy(pluginToBeInstalled.strategy);
        } else {
          throw new Error('plugin.strategy has wrong syntax! strategy and routes have to be functions!');
        }
      }

      if (typeof pluginToBeInstalled.app === 'function') {
        this.extendApp(pluginToBeInstalled.app);
      }

      if (pluginToBeInstalled.middleware !== undefined) {
        if (pluginToBeInstalled.middleware instanceof Array) {
          for (i = 0; i < pluginToBeInstalled.middleware.length; i = i + 1) {
            if (typeof pluginToBeInstalled.middleware[i] === 'function') {
              this.extendMiddleware(pluginToBeInstalled.middleware[i]);
            } else {
              throw new Error('plugin.middleware[' + i + '] is not a function!');
            }
          }
        } else {
          if (typeof pluginToBeInstalled.middleware === 'function') {
            this.extendMiddleware(pluginToBeInstalled.middleware);
          } else {
            throw new Error('plugin.middleware is not a function!');
          }
        }
      }
      if (typeof pluginToBeInstalled.routes === 'function') {
        this.extendRoutes(pluginToBeInstalled.routes);
      }

      if (typeof pluginToBeInstalled.listeners === 'object') {
        for (y in pluginToBeInstalled.listeners) {
          if (pluginToBeInstalled.listeners.hasOwnProperty(y)) {
            this.extendListeners(y, pluginToBeInstalled.listeners[y]);
          }
        }
      }

      return this;
    }
  };

  /**
   * @ngdoc function
   * @name kabamKernel.start
   * @description
   * Start mwc application
   * Parameters:
   *
   * *null* bind expressJS application to default port (process.env.PORT)
   * or 3000 port, makes kabamKernel emit event of `started` with value
   * `{'type':'expressHttp', 'port':3000}`, returns kabamKernel
   *
   * *number* - bind expressJS application to this port,
   * makes kabamKernel emit event of `started` with value `{'type':'expressHttp', 'port':3001}`,
   * where 3001 is port number desired, and returns kabamKernel
   *
   * *string of 'app'* - start appliation as standalone object,
   * for background workers and console scripts,
   * makes kabamKernel emit event of `started` with value `{'type':'app'}`,
   * returns kabamKernel
   *
   * It emits events of "started"
   * @param {object} howExactly - config object, see parameters in description
   *
   * @example
   * ```javascript
   *
   *   //different ways to bind application to 3000 port
   *   mwc.start('app');
   *   mwc.app.listen(3000);
   *
   *   mwc.start(); //binds to default port, 3000
   *
   *   mwc.start(3000); //binds to  port 3000
   *
   *   var http = require('http');
   *   mwc.start(http).listen(mwc.app.get('port'));
   *
   *   //with socket.io
   *   //this is done in this way, because we can attach socket.io easily
   *   var http = require('http');
   *   var server = mwc.start(http);
   *   io = require('socket.io').listen(server);
   *   server.listen(mwc.app.get('port'));
   *
   *   //setting up the https
   *   var https = require('https');
   *   mwc.start(https,{
   *     key: fs.readFileSync('test/fixtures/keys/agent2-key.pem'),
   *     cert: fs.readFileSync('test/fixtures/keys/agent2-cert.pem')
   *   }).listen(mwc.app.get('port'));
   *
   * ```
   */
  this.start = function (howExactly) {
    prepared = true;
    //injecting redis
    thisMWC.redisClient = redisManager.create(thisMWC.config.redis);

    //injecting mongoose and additional models
    thisMWC.model = mongooseManager.injectModels(thisMWC, additionalModels);

    extendCoreFunctions.map(function (settingsFunction) {

      if (thisMWC[settingsFunction.namespace] === undefined) {
        thisMWC[settingsFunction.namespace] = {};
      }
      if (thisMWC[settingsFunction.namespace][settingsFunction.field] === undefined) {
        thisMWC[settingsFunction.namespace][settingsFunction.field] = settingsFunction.factoryFunction(thisMWC.config);
      } else {
        throw new Error('Kernel namespace collision - namespace "' + settingsFunction.namespace + '" already have field of ' + settingsFunction.field);
      }

    });

    //initialize expressJS application
    thisMWC.app = appManager(thisMWC, extendAppFunctions, additionalStrategies, extendMiddlewareFunctions, extendRoutesFunctions, catchAllFunction);
    if (howExactly) {
      if (howExactly === 'app') {
        thisMWC.emit('started', { 'type': 'app' });
        return thisMWC;
      }
      if (typeof howExactly === 'number' && howExactly > 0) {
        thisMWC.httpServer.listen(howExactly, function () {
          thisMWC.emit('started', {'port': howExactly, 'type': 'expressHttp'});
          console.log(('KabamKernel started on ' + howExactly + ' port').blue);
        });
        return thisMWC;
      }
      throw new Error('Function MWC.listen(httpOrHttpsOrPort) accepts objects of null, "app" or port\'s number as argument!');
    } else {
      thisMWC.httpServer.listen(thisMWC.app.get('port'), function () {
        thisMWC.emit('started', {'port': thisMWC.app.get('port'), 'type': 'expressHttp'});
        console.log(('KabamKernel started on ' + thisMWC.app.get('port') + ' port').blue);
      });
      return thisMWC;
    }
  };
  /**
   * @ngdoc function
   * @name kabamKernel.startCluster
   * @description
   * Start mwc application as a cluster, with 1 process per CPU core.
   * This command start the process master by mwc.start('app') - so it do not listens to http port,
   * and the other ones as mwc.start(howExactly,options). When mwc is runned as cluster, it restarts killed processes
   * @param {object} howExactly - object, same as for mwc.start
   * Values:
   *
   * - null - bind expressJS application of worker process to default port (process.env.PORT) or 3000 port
   * - number - bind expressJS application of worker process to this port
   * - string of 'app' - start expressJS appliation of worker process as standalone object, for background workers and console scripts
   *
   * @returns {boolean} isMaster. Returns true, if this process is a master process of cluster, or false if this is slave process
   */
  this.startCluster = function (howExactly) {
    prepared = true;

    var thisMWC = this,
      cluster = require('cluster'),
      numCPUs = require('os').cpus().length,
      maxWorkers,
      i;

    if (this.config.limitWorkers && this.config.limitWorkers > 0) {
      maxWorkers  = Math.min(numCPUs, this.config.limitWorkers);
    } else {
      maxWorkers = numCPUs;
    }


    if (cluster.isMaster) {
      console.log(('Cluster : We have ' + numCPUs + ' CPU cores present. We can use ' + maxWorkers + ' of them.').bold.green);
      console.log(('Cluster : Master PID#' + process.pid + ' is online').green);
      // Fork workers.
      for (i = 0; i < maxWorkers; i = i + 1) {
        var worker = cluster.fork();
        console.log(('Cluster : Spawning worker with PID#' + worker.process.pid).green);
      }

      cluster.on('online', function (worker) {
        console.log(('Cluster : Worker PID#' + worker.process.pid + ' is online').green);
      });

      cluster.on('exit', function (worker, code, signal) {
        var exitCode = worker.process.exitCode;
        console.log(('Cluster : Worker #' + worker.process.pid + ' died (' + exitCode + '). Respawning...').yellow);
        cluster.fork();
      });

      thisMWC.start('app'); // the master process is ran as background application and do not listens to port
      return true;
    } else {
      thisMWC.start(howExactly);
      return false;
    }
  };
}

util.inherits(KabamKernel, EventEmitter);

KabamKernel.prototype.validateConfig = function (config) {
  // General check
  if(typeof config !== 'object') {
    throw new Error('Config is not an object!');
  }
  if (!(config.hostUrl && url.parse(config.hostUrl).hostname)) {
    throw new Error('Config.hostUrl have to be valid hostname - for example, http://example.org/ with http(s) on start and "/" at end!!!');
  }
  if (config.secret.length < 9) {
    throw new Error('Config.secret is not set or is to short!');
  }

  mongooseManager.validateConfig(config.mongoUrl);
  redisManager.validateConfig(config.redis);

  return true;
};


/**
 * @ngdoc function
 * @name kabamKernel.extendListeners
 * @param {string} eventName Name of the event
 * @param {function} eventHandlerFunction Function to handle the event
 * @description - add custom event handler for mwc
 * @example
 * ``` javascript
 *
 *      mwc.extendListeners('someEvent', console.log);
 *
 * ```
 * @returns {kabamKernel} mwc object
 */
KabamKernel.prototype.extendListeners = function (eventName, eventHandlerFunction) {
  if (typeof eventName === 'string' && typeof eventHandlerFunction === 'function') {
    this.on(eventName, eventHandlerFunction);
  } else {
    throw new Error('KabamKernel.extendListeners(eventName,eventHandlerFunction) have wrong arguments!');
  }
  return this;
};


/**
 * @ngdoc function
 * @name kabamKernel.injectEmit
 * @description
 * Injects a function .emit(eventName,eventObj) for every object. This function
 * is used for making this object to be able to emit events through mwc
 * @param {object} object - object to be extended
 */
KabamKernel.prototype.injectEmit = function (object) {
  var thisMWC = this;
  object.emitMWC = function (eventName, eventContent) {
    thisMWC.emit(eventName, eventContent);
  };
};

/**
 * @ngdoc function
 * @name kabamKernel.createRedisClient
 * @description
 * Create new redis client
 *
 * Use this function with great caution! Because usually redis-database-as-a-service providers have
 * strict connection limit!!! and every one redis client created like this consumes one connection!
 * Usually, MWC needs only one redis client connection
 * BTW, redis is NOT MySQL - we can't increase speed with connection pooling!
 * @returns {RedisClient} redis client
 */
KabamKernel.prototype.createRedisClient = function () {
  return redisManager.create(this.config.redis);
};

/**
 * @ngdoc function
 * @name kabamKernel.create
 * @description
 * Create MWC object instance (factory)
 * @param {object} config - config object
 * @example
 * ```javascript
 * //minimal config object example
 *
 * var config = {
 *   "hostUrl":"http://example.org/", //host url, can be quessed from enviroment
 *   "mongoUrl":"mongodb://username:password@mongoServer:27017/databaseName", *   // valid mongoUrl, can be quessed
 *   "secret":"LongAndHardSecretStringToPreventSessionHiJask", // can be quessed, but we recommend to set it
 * //"redis": "redis://prefix:authPassword@redisServer:6379",  //url to redis server, can be ommited
 *
 * //"redis": {"host":"redisServer", "port":6379,"auth":"authPassword"},
 * //redis server parameters in different notation, can be ommited
 *
 *   "redis": {"host":"localhost", "port":6379,"auth":""}, //default redis server values
 *   "disableCsrf" : false // disable csrf protection for application
 *   //"io":{'loglevel':1 }, //uncomment t his field to enable socket.io
 *   //'limitWorkers': 2, //uncomment this string to set the max worker processes number the cluster spawn
 * };
 *
 * //minimal runnable example
 * var KabamKernel = require('mwc_kernel);
 * kabamKernel = mwc(config);
 * kabamKernel.start();
 *
 * ```
 */
KabamKernel.create = function (config) {
  return new KabamKernel(config);
};

/**
 * @ngdoc function
 * @name kabamKernel.stop
 * @description
 * Stops kabamKernel instance - close redis and mongo connections.
 */
KabamKernel.prototype.stop = function () {
  this.redisClient.end();
  this.mongoose.connection.close();
  this.mongoose.disconnect();
  return;
};

module.exports = exports = KabamKernel.create;

/**
 * @ngdoc function
 * @name kabamKernel.on
 * @usage
 * kabamKernel.on('someEvent',function(payload){...});
 * @description
 * kabamKernel inherits all methods, including this, from nodejs event emitter.
 * Adds a listener to the end of the listeners array for the specified event.
 * See [official nodejs manual] (http://nodejs.org/api/events.html)
 *
 * There can be more event emmiters than in documentation. Probably from plugins and some 3rd party code.
 *
 * *Event emitted from user model*
 * [http://ci.monimus.com/docs/#/api/User.eventsEmitter](http://ci.monimus.com/docs/#/api/User.eventsEmitter)
 * [http://ci.monimus.com/docs/#/api/kabamKernel.model.User.eventsEmitter](http://ci.monimus.com/docs/#/api/kabamKernel.model.User.eventsEmitter)
 *
 * *Events emmited from starting application*
 * [http://ci.monimus.com/docs/#/api/kabamKernel.start](http://ci.monimus.com/docs/#/api/kabamKernel.start)
 *
 * *Event emmited from http server*
 * They have type of `http` and are like this:
 * ```javascript
 * {
 *   startTime: Wed Aug 21 2013 01:52:34 GMT+0400 (MSK),
 *   duration: 49,
 *   statusCode: 200,
 *   method: 'GET',
 *   ip: '127.0.0.1',
 *   uri: '/',
 *   username:'johndoe',
 *   email:'email'
 * }
 * ```
 *
 * More info on event listeners - [http://nodejs.org/api/events.html#events_emitter_on_event_listener](http://nodejs.org/api/events.html#events_emitter_on_event_listener)
 * @param {string} eventName - the name of event type
 * @param {function} handlerFunction - function used to process the event
 * @example
 * ```javascript
 *    kabamKernel.on('error', functon(error){ //this is standart event emitter
 *      console.error(error);
 *    });
 *
 *    //event emmited from starting application
 *    kabamKernel.on('started',function(parametes){...});
 *
 *    //event emmiters from users model
 *    kabamKernel.on('users:revokeRole', function(user){...});
 *    kabamKernel.on('users:signUp', function(user){...});
 *    kabamKernel.on('users:signUpByEmailOnly', function(user){...});
 *    kabamKernel.on('users:completeProfile', function(user){...});
 *    kabamKernel.on('users:saveProfile', function(user){...});
 *    kabamKernel.on('users:setKeyChain', function(user){...});
 *    kabamKernel.on('users:revokeKeyChain', function(user){...});
 *    kabamKernel.on('users:findOneByApiKeyAndVerify', function(user){...});
 *    kabamKernel.on('users:ban', function(user){...});
 *    kabamKernel.on('users:unban', function(user){...});
 * ```
 */

/**
 * @ngdoc function
 * @name kabamKernel.once
 * @usage
 * kabamKernel.once('someEvent',function(payload){...});
 * @description
 * Adds a one time listener for the event. This listener is invoked only the next time the event is fired, after which it is removed.
 * kabamKernel inherits all methods, including this, from nodejs event emitter.
 * See [official nodejs manual] (http://nodejs.org/api/events.html)
 * It works only once.
 * All things are identical to [http://ci.monimus.com/docs/#/api/kabamKernel.on](http://ci.monimus.com/docs/#/api/kabamKernel.on)
 * @param {string} eventName - the name of event type
 * @param {function} handlerFunction - function used to process the event
 */

/**
 * @ngdoc function
 * @name kabamKernel.addListener
 * @description
 * kabamKernel inherits all methods, including this, from nodejs event emitter.
 * See [official nodejs manual] (http://nodejs.org/api/events.html#events_emitter_addlistener_event_listener)
 */

/**
 * @ngdoc function
 * @name kabamKernel.removeListener
 * @description
 * kabamKernel inherits all methods, including this, from nodejs event emitter.
 * See [official nodejs manual](http://nodejs.org/api/events.html#events_emitter_removelistener_event_listener)
 */

/**
 * @ngdoc function
 * @name kabamKernel.removeAllListeners
 * @description
 * kabamKernel inherits all methods, including this, from nodejs event emitter.
 * See [official nodejs manual] (http://nodejs.org/api/events.html#events_emitter_removealllisteners_event)
 */

/**
 * @ngdoc function
 * @name kabamKernel.setMaxListeners
 * @description
 * kabamKernel inherits all methods, including this, from nodejs event emitter.
 * See [official nodejs manual] (http://nodejs.org/api/events.html#events_emitter_setmaxlisteners_n)
 */

/**
 * @ngdoc function
 * @name kabamKernel.listeners
 * @description
 * kabamKernel inherits all methods, including this, from nodejs event emitter.
 * See [official nodejs manual] (http://nodejs.org/api/events.html#events_emitter_listeners_event)
 */

/**
 * @ngdoc function
 * @name kabamKernel.emit
 * @description
 * kabamKernel inherits all methods, including this, from nodejs event emitter.
 * See [official nodejs manual](http://nodejs.org/api/events.html#events_emitter_emit_event_arg1_arg2)
 */
