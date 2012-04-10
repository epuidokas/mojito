/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */


/*jslint anon:true, sloppy:true, nomen:true*/


var qs = require('querystring'),
    YUI = require('yui3').YUI,
    logger,
    liburl = require('url'),
    RX_END_SLASHES = /\/+$/,
    NAME = 'UriRouter';


function simpleMerge(to, from) {
    var p;
    for (p in from) {
        if (from.hasOwnProperty(p)) {
            if (!to[p]) {
                to[p] = from[p];
            }
        }
    }
    return to;
}


/**
 * The Routing component of Mojito.
 * @class MojitoRouter
 * @param {Object} store The resource store for the router to use.
 * @constructor
 * @private
 */
function Router(store) {
    var self = this;
    self._store = store;
    YUI().use('cache-base', function(Y) {
        self._computedRoutes = new Y.Cache({max:1000, uniqueKeys:true});
    });
}


Router.prototype = {

    handle: function(store, globalLogger, RouteMakerClass) {
        logger = globalLogger;

        var self = this;

        return function(req, res, next) {
            var command = {instance: {}},
                context = req.context,
                routes = store.getRoutes(context),
                routeMaker = new RouteMakerClass(routes),
                query = liburl.parse(req.url, true).query,
                appConfig = store.getAppConfig(context, 'definition'),
                url,
                routeMatch;

            url = req.url.replace(RX_END_SLASHES, '/');
            routeMatch = self.getRoute(req.method, url, routeMaker);

            // TODO: [Issue 93] Check to see that there is not
            // already a command attached to req

            // TODO: [Issue 94] LOSE query string routing
            if (!routeMatch && appConfig.allowQueryStringRouting) {
//                logger.log('[UriRouter] matching URL query string...');
                routeMatch = {
                    call: [
                        (query['mojit-base']),
                        (query['mojit-action'] || 'index')
                    ]
                };
                // there is no default mojit id to execute, so if there is no
                // mojit id within the url, it makes sense to null the route,
                // resulting in a 404
                if (!routeMatch.call[0]) {
                    routeMatch = null;
                }
            }

            // at this point if we haven't found a route, get out
            if (!routeMatch) {
//                logger.log('[UriRouter] Match fail');
                return next();
            }

            if (routeMatch.call[0][0] === '@') {
                // If the route starts with an "@" it is a "type"
                command.instance.type = routeMatch.call[0].slice(1);
            } else {
                // Otherwise it is "instance"
                command.instance.base = routeMatch.call[0];
            }

            command.action = routeMatch.call[1];
            // TODO: [Issue 95] attach action to command instead
            // of instance
            // command.action = routeMatch.call[1];
            command.context = req.context;
            command.params = {
                route: simpleMerge(routeMatch.query,
                    qs.parse(routeMatch.param)),
                url: query || {},
                body: req.body || {},
                file: {} // FUTURE: add multi-part file data here
            };

            // logger.log('Attaching command: ' +
            //     JSON.stringify(command, null, 2), 'debug', 'uri-router');

            // attach the command to the route for the Mojito handler to process
            req.command = command;
            next();
        };

    },

    /**
     * Finds a route for a given method+URL
     *
     * @param {string} method The HTTP method.
     * @param {string} url The URL to find a route for.
     * @param {RouteMaker} routeMaker The route maker.
     * @return {Object} The route.
     **/
    getRoute: function(method, url, routeMaker) {

//        logger.log('[UriRouter] routing ' + method + ' ' + url);
        var name, route, call = [], routeCacheKey, routeCache;

        // strip query string
        if (url.indexOf('?') > -1) {
            url = url.split('?')[0];
        }

        routeCacheKey = method + " " + url;
        routeCache = (this._computedRoutes) ? this._computedRoutes.retrieve(routeCacheKey) : null;

        if (routeCache !== null) {
            route = routeCache.response;
        } else {
            route = routeMaker.find(url, method);

            if (!route) {
                return null;
            }

            if ('*.*' === route.call) {
                route.call = route.query.module + '.' + route.query.action;
            }

            call[0] = route.call.split('.');
            call[1] = call[0].pop();
            call[0] = call[0].join('.');

            route.call = call;

            this._computedRoutes.add(routeCacheKey, route);
        }

        // This code does not know what Mojito is so just return the route.
        return route;
    }

};


/**
 * Export a function capable of building a viable router.
 * @param {Object} config Data to configure the router.
 * @return {Object} The newly constructed router.
 */
module.exports = function(config) {
    var router = new Router(config.store);
    // we need to expose the getRoute method for unit testing
    module.exports.getRoute = router.getRoute;
    return router.handle(config.store, config.logger,
        config.Y.mojito.RouteMaker);
};


