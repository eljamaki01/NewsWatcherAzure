//
// asyncQHelper: A Node.js Module that serializes operations to shared Document access that might experience conflicts because of concurrency usage.
// Operations are serialized by placing them on this queue are servicing them in order one by one.
// If you need to scale further, implemnent an Azure queue storage and pull from there in a single worker role that uses this same q for what is pulled of.
// We set the worker concurrency to one because we want everything serialized.
// NOTE: could actually set the concurrent processing at something hier such as 3 if you implement retry logic with Optimistic Concurrency.
//

"use strict";
var async = require('async');
var config = require('../config');

var async = require('async');

var q = async.queue(function (task, callback) {
   task.fcn(task.params, callback);
}, 1);

q.drain = function () {
   console.log('<<<<<<<<<<<<<all items have been processed');
}

module.exports = q;