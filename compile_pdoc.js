"use strict";

var Exec = require("child_process").exec;

Exec("jison ./lib/panino/plugins/parsers/javascript/pdoc/pdoc.y", function(error, stdout, stderr) {
    if (error) {
        console.error(stderr);
        process.exit(1);
    }

    Exec("mv pdoc.js ./lib/panino/plugins/parsers/javascript/pdoc/pdoc.js", function(error, stdout, stderr) {
        if (error) {
            console.error(stderr);
            process.exit(1);
        }
    });
});