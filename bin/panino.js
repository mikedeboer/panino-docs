#!/usr/bin/env node

"use strict";

// stdlib
var Path = require("path");

// 3rd-party
var Async = require("async");

// internal
var Panino = require("..");
var Template = require("../lib/panino/common").template;

function exit(err) {
    if (err) {
        console.error(err.message || err);
        process.exit(1);
    }

    process.exit(0);
}

//
// preprocess plugins
//
Panino.cli.parseKnownArgs().shift().use.forEach(function(pathname) {
    if (/^\./.test(pathname))
        pathname = Path.resolve(process.cwd(), pathname);

    try {
        Panino.use(require(pathname));
    }
    catch (err) {
        exit("Failed add renderer: " + pathname + "\n\n" + err.toString());
    }
});

//
// parse options
//
var options = Panino.cli.parseArgs();

//
// Process aliases
//
options.aliases.forEach(function(pair) {
    Panino.extensionAlias.apply(null, pair.split(":"));
});

//
// Post-process some of the options
//
options.title = Template(options.title || "", {
    "package": options.package
});
options.index = options.index || "";

//
// collect sources, parse into ast, render
//
Async.waterfall([
    function collect_files(next) {
        Panino.cli.findFiles(options.paths, options.exclude, next);
    },
    function parse_files(files, next) {
        Panino.parse(files, options, next);
    },
    function render_ast(ast, next) {
        Panino.render(options.renderer, ast, options, next);
    }
], exit);
