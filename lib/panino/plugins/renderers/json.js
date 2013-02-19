/** internal, section: Plugins
/** internal, section: Plugins
 *  Renderers.json(Panino) -> Void
 *
 *  Registers JSON renderer as `json`.
 *
 *
 *  ##### Example
 *
 *      Panino.render("json", ast, options, function (err) {
 *        // ...
 *      });
 *
 *
 *  ##### Options
 *
 *  - **output** (String): File where to output rendered documentation.
 *  - **title** (String): Page title template. You can use `{package.*}`
 *    variables here.
 *    Default: `"{package.name} {package.version} API documentation"`
 **/
"use strict";


// stdlib
var Fs = require("fs");
var Path = require("path");
var Wrench = require("wrench");

module.exports = function(Panino) {
    Panino.registerRenderer("json", function render_json(ast, options, callback) {

        if (!options.keepOutDir) {
            Wrench.rmdirSyncRecursive(options.output, true);
        }
        Wrench.mkdirSyncRecursive(options.output, "0755");

        if (options.formatJSON) {
            Fs.writeFile(Path.join(options.output, Path.basename(options.output).replace("/", "").replace("\\", "") + ".json"), JSON.stringify({
                title: options.title,
                date: (new Date()).toUTCString(),
                tree: ast.tree
            }, null, "    "), callback);
        }
        else {
            Fs.writeFile(Path.join(options.output, Path.basename(options.output).replace("/", "").replace("\\", "") + ".json"), JSON.stringify({
                title: options.title,
                date: (new Date()).toUTCString(),
                tree: ast.tree
            }), callback);
        }
    });
};
