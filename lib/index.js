'use strict';

var fs = require('fs');
var Path = require('path');
var util = require('util');

var parser = require('./parser').parser;
var md_conrefs = require('markdown_conrefs');

// keep a list of global objects, so that we can link to proper documentation when required
var globalObjs;
var globalObjsJSON = JSON.parse(fs.readFileSync(process.cwd() + "/lib/objs.json", "utf8"));

//
// helpers
//
function extend(o, plus) {
    var r = {},
        i;
    for (i in o) {
        if (o.hasOwnProperty(i)) {
            r[i] = o[i];
        }
    }
    if (plus) {
        for (i in plus) {
            if (plus.hasOwnProperty(i)) {
                r[i] = plus[i];
            }
        }
    }
    return r;
}

/**
 * class Panino
 *
 * Handles documentation tree.
 **/

/**
 * new Panino(files, options)
 * - files (Array): array of source file paths
 * - options (Hash): controlling options
 *
 * Read source `files` and compose the documentation tree.
 **/
function Panino(files, options) {

    // options
    this.options = extend({}, options);

    // documentation tree consists of sections, which are populated with documents
    var list = {
        '': {
            id: '',
            type: 'section',
            children: [],
            description: '',
            short_description: '',
            ellipsis_description: ''
        },
    },
        t, parted, len, i, id, idx, p, pid, d, g, tree, children;

    // parse specified source files
    files.forEach(function (file) {
        console.log('Compiling file', file);

        var parentDir = file.split("/")[2];

        // parse file
        var text, panini, id, d, d1;
        try {
            text = fs.readFileSync(file, 'utf8');

            if (options.extension == 'md' || options.extension == 'markdown') {
                if (options.globalObjType == "NADA") {
                    console.error("You're building markdown files, but you also need to tell me what kind of language you're documenting using -g.");
                    process.exit(1);
                }
                else {
                    globalObjs = getGlobalObjs(options.globalObjType);
                }
                text = convertMD(file, text);
                //console.warn(text);
            }
            else {
                globalObjs = getGlobalObjs(options.extension);
            }

            try {
                options.parseOptions = JSON.parse(options.parseOptions);
            }
            catch (e) {
                console.error("Something wen wrong trying to parse your JSON parse options:");
                console.error(e);
                process.exit(1);
            }

            //parser.opts = {}
            parser.yy.useDash = options.parseOptions.useDash;
            parser.yy.useAsterisk = options.parseOptions.useAsterisk;

            // TODO: consider amending failing document inplace.
            // Say, if it doesn't parse, insert a fake '*' line at failing `line` and retry
            panini = parser.parse(text);

            //console.log(panini)
            // do pre-distribute early work
            for (id in panini) {
                if (panini.hasOwnProperty(id)) {
                    d = panini[id];
                    // assign hierarchy helpers
                    d.aliases = [];
                    d.children = [];
                    d.parentDir = parentDir;
                    d.filename = file.substring(file.lastIndexOf("/") + 1); // can be used in templates
                    if (d.type === 'class') {
                        d.subclasses = [];
                    }
                    // collect sections
                    if (d.type === 'section') {
                        list[d.id] = d;
                        // collect flat list
                    }
                    else {
                        // elements with undefined section get '' section,
                        // and will be resolved later, when we'll have full
                        // element list
                        list[(d.section || '') + '.' + d.id] = d;
                        // bound methods produce two methods with the same description but different signatures
                        // E.g. Element.foo(@element, a, b) becomes
                        // Element.foo(element, a, b) and Element#foo(a, b)
                        if (d.type === 'method' && d.bound) {
                            d1 = extend(d);
                            d1.id = d.id.replace(/(.+)\.(.+)/, '$1#$2');
                            // link to methods
                            d.bound = d1.id;
                            d1.bound = d.id;
                            // insert bound method clone
                            list[(d.section || '') + '.' + d1.id] = d1;
                        }
                    }
                    // compose links to source files
                    if (options.formatLink) {
                        d.href = options.formatLink(file, d.line);
                    }
                }
            }
        }
        catch (err) {
            console.error('FATAL:', file, err.message || err);
            process.exit(1);
        }
    });

    // TODO: section.related_to should mark related element as belonging to the section
    /*for (id in list) {
    var d = list[id];
    if (d.type === 'section' && d.related_to && list['.' + d.related_to]) {
      var d1 = list['.' + d.related_to];
      d1.id = d.id + '.' + d.related_to;
      delete list['.' + d.related_to];
      list[d1.id] = d1;
    }
  }*/

    for (id in list) {
        if (list.hasOwnProperty(id)) {
            d = list[id];

            if (d.type === 'class') {
                // if the class has a subclass, remove it as a "child" and 
                // place it as its own proper node; let the layout deal with
                // these; but obviously, maintain the relationship through
                //  superclass/subclasses properties
                if (d.superclass) {
                    list[d.id] = d;
                }
            }
        }
    }

    // for each element with undefined section try to guess the section
    // E.g. for ".Ajax.Updater" we try to find "SECTION.Ajax" element.
    // If found, rename ".Ajax.Updater" to "SECTION.Ajax.Updater"
    t = Object.keys(list).sort();
    parted = t.map(function (id) {
        return id.split(/[.#@]/);
    });
    len = parted.length;
    // N.B. starting with 1 we skip "" section
    for (idx = 1; idx < len; idx += 1) {
        if (parted[idx][0] === '') {
            for (i = idx + 1; i < len; i += 1) {
                if (parted[idx][1] === parted[i][1] && parted[i][0] !== '') {
                    p = t[idx];
                    // prefix with guessed section
                    t[idx] = parted[i][0] + t[idx];
                    //if (!p) console.log('RENAME [%s] -> [%s]', p, t[idx], parted[idx], parted[i]);
                    // update flat list element, since key and value's id has been changed
                    g = list[p];
                    delete list[p];
                    g.id = p = t[idx];
                    list[p] = g;
                    break;
                }
            }
        }
    }

    // sort elements in case-insensitive manner
    tree = {};
    t = t.sort(function (a, b) {
        a = a.toLowerCase();
        b = b.toLowerCase();
        return a === b ? 0 : a < b ? -1 : 1;
    });
    t.forEach(function (id) {
        tree[id] = list[id];
    });

    // rebuild the tree from the end to beginning.
    // N.B. since the list we iterate over is sorted, we can determine precisely
    // the parent of any element.
    for (i = t.length - 1; i >= 1; i -= 1) {
        id = t[i];
        // parent name is this element's name without portion after
        // the last '.' for class member, '#' for instance member,
        // or '@' for events
        idx = Math.max(id.lastIndexOf('.'), id.lastIndexOf('#'), id.lastIndexOf('@'));
        // no '.' or '#' found? this is top level section. just skip it
        if (idx >= 0) {
            // extract parent name
            pid = id.substring(0, idx);
            // get parent element
            p = tree[pid];
            // no parent element? skip this
            if (p) {
                // parent element found. move this element to parent's children list, maintaing order
                p.children.unshift(tree[id]);
                //tree[id].parent = pid;
                delete tree[id];
            }
        }
    }

    // cleanup list, reassign right ids after we resolved
    // to which sections every element belongs
    for (id in list) {
        if (list.hasOwnProperty(id)) {
            d = list[id];
            delete list[id];
            // compose new id
            d.id = id.replace(/^[^.]*\./, '');
            d.name = d.id.replace(/^.*[.#@]/, '');
            // sections have lowercased ids, to not clash with other elements
            if (d.type === 'section') {
                d.id = d.id.toLowerCase();
            }
            // prototype members have different paths
            // events have different paths as well
            d.path = d.id.replace(/#/g, '.prototype.').replace(/@/g, '.event.');
            delete d.section;
            // prune sections from list
            if (d.type !== 'section') {
                //delete d.children;
                list[d.id] = d;
            }
        }
    }

    // assign aliases, subclasses, constructors
    // correct method types (class or entity)
    for (id in list) {
        if (list.hasOwnProperty(id)) {
            d = list[id];

            // aliases
            if (d.alias_of && list[d.alias_of]) {
                list[d.alias_of].aliases.push(d.id);
            }

            // classes hierarchy
            if (d.type === 'class') {
                // if the class has a subclass, remove it as a "child" and 
                // place it as its own proper node; let the layout deal with
                // these; but obviously, maintain the relationship through
                //  superclass/subclasses properties
                if (d.superclass && list[d.superclass]) {
                    for (var subs in list[d.superclass].children) {
                        if (list[d.superclass].children[subs].id == d.id) {
                            delete list[d.superclass].children[subs];
                        }
                    }
                    list[d.superclass].subclasses.push(d.id);
                }
            }

            //   if (d.id.indexOf('@') >= 0) {
            //     d.type = 'event';
            //   }
            // methods and properties
            else if (d.type === 'method' || d.type === 'property') {
                if (d.id.match(/^\$/)) {
                    d.type = 'utility';
                }
                if (d.id.indexOf('#') >= 0) {
                    d.type = 'instance ' + d.type;
                }
                else if (d.id.indexOf('.') >= 0) {
                    d.type = 'class ' + d.type;
                }
                else if (d.id.indexOf('@') >= 0) {
                    // FIXME: shouldn't it be assigned by parser?
                    d.type = 'event';
                }
                // constructor
            }
            else if (d.type === 'constructor') {
                d.id = 'new ' + d.id.replace(/\.new$/, '');
            }
        }
    }

    // tree is hash of sections.
    // convert sections to uniform children array of tree top level
    children = [];
    for (id in tree) {
        if (tree.hasOwnProperty(id)) {
            if (id === '') {
                children = children.concat(tree[id].children);
            }
            else {
                children.push(tree[id]);
            }
            delete tree[id];
        }
    }
    tree.children = children;

    // store tree and flat list
    this.list = list;
    this.tree = tree;

    // for splitting out files
    this.outfile = d.filename;
    if (this.outfile !== undefined && this.outfile.indexOf("_") >= 0) {
        var scoreToDot = new RegExp(/_/g);
        this.outfile = this.outfile.replace(scoreToDot, ".");
    }
    else if (this.outfile === undefined) {
        this.outfile = "";
    }
}

// why all this? some groups want to use straight Markdown files, instead of cumbersome
// JS commenting, what with asterisks and the building and the blah. I spent a few hours trying
// to change parser.y to accept lines that don't start with asterisks, and still couldn't
// get it right. Fuck it, we'll do it live.
function convertMD(file, text) {
    var textLines = text.split("\n");

    var firstClass = {
        found: false,
        name: ""
    };
    var re;

    if (re = textLines[0].match(/^\#{1} (.+)/)) { // if #, it's only a title
        var metaExpr = /<!--([^=]+)=([^\-]+)-->\n*/g;
        var metaString = textLines[1].match(metaExpr);

        if (!metaString) {
            console.error("In " + file + " you started with #, but provided no context--that's bad.");
            process.exit(0);
        }

        metaString = metaString[0];
        var meta = metaString.substring(4, metaString.length - 3).split(" ");
        var metaJson = {};
        for (var m in meta) {
            var keyVal = meta[m].split("=");
            metaJson[keyVal[0]] = keyVal[1];
        }
        if (metaJson.type == 'class') {
            if (metaJson.name === undefined) {
                console.error("In " + file + " you told me it's a class, but didn't give me a name.");
                process.exit(0);
            }
            textLines[0] = "/**\n* section " + textLines[0] + "\n**/";
            textLines[1] = "/**\n* " + textLines[1].replace(metaString, "class " + metaJson.name);
            firstClass.found = true;
            firstClass.name = metaJson.name;
        }
        else if (metaJson.type == 'misc') {
            var title = textLines[0].substr(2).replace(/(\w) /g, "$1");
            textLines[0] = "/** section: " + title + "\n";
            textLines[1] = "* class " + title;

            for (l = 2; l < textLines.length; l++) {
                textLines[l] = "* " + textLines[l];
            }
            textLines.push("**/");
            return textLines.join("\n");
        }
        else {
            console.error("In " + file + " I did not understand the type '" + metaJson.type + "'");
        }
    }
    else if (re = textLines[0].match(/^\#{2} (.+)/)) { // if ##, it's a class
        if (!firstClass.found) {
            firstClass.found = true;
            firstClass.name = re[1];
            textLines[0] = "/**\n* " + "class " + firstClass.name;
            textLines[1] = "* "; // will this ever have metadata?
        }
    }
    else {
        console.error("First line in " + file + " is neither # or ##--that's bad.");
        process.exit(1);
    }

    for (var l = 2; l < textLines.length; l++) {
        if (re = textLines[l].match(/^\#{2} (.+)/)) { // if ##, it's a class
            if (!firstClass.found) {
                firstClass.found = true;
                firstClass.name = re[1];
                textLines[l] = "/**\n* " + textLines[l].replace("##", "class " + firstClass.name);
            }
            else {
                if (re[1].indexOf("<") < 0) textLines[l] = "**/\n\n/**\n* " + "class " + re[1] + " < " + firstClass.name;
            }
        }
        else if (textLines[l].match(/^\#{3} /)) { // if ###, it's a member
            textLines[l] = "**/\n\n/**\n* " + textLines[l].replace("###", "");
            var n = l + 1;

            while (textLines[n].match(/^\#{3} /)) { // it has aliases
                textLines[n] = " " + textLines[n].replace("###", "");
                n++;
            }

            var tagRE = textLines[n].match(/^(\((.+)\))/);
            if (tagRE) { // if it's got tags, add them appropriately to the starting /**
                textLines[l] = textLines[l].replace("/**", "/** " + tagRE[2]);
                textLines[n] = "";
                n++;
            }
            while (textLines[n].match(/[-|*] .+? {.+?} /)) {
                textLines[n] = textLines[n].replace("{", "(").replace("}", "):");
                n++;
            }
        }
        else { // everything else just prefix with a "*"
            textLines[l] = "* " + textLines[l];
        }
    }

    textLines.push("**/");

    return textLines.join("\n");
}

/**
 * Panino#toJSON(options) -> String
 *
 * Renders this documentation tree to JSON string.
 **/
Panino.prototype.toJSON = function (options) {
    var list = {},
        id, d;
    for (id in this.list) {
        if (this.list.hasOwnProperty(id)) {
            d = this.list[id];
            list[id] = {
                id: d.id,
                type: d.type,
                name: d.name,
                path: d.path,
                parent: d.parent,
                section: d.section,
            };
        }
    }
    return JSON.stringify(extend(options, {
        list: this.list,
        tree: this.tree,
        date: (new Date()).toUTCString(),
    }), null, "\t");
};

/**
 * Panino#toHTML(options) -> String
 *
 * Renders this documentation tree to HTML string.
 **/
Panino.prototype.toHTML = function (options) {

    var Jade = require('jade'),
        md2html = require('marked'),

        // prepare rendering function
        // TODO: store it for further reuse, and get rid of jade dependency?
        path = Path.join(options.skin, 'templates', 'layout.jade'),
        str = fs.readFileSync(path, 'utf8'),
        fn = Jade.compile(str, {
            filename: path,
            pretty: false
        }),

        // it's illegal to have slashes in HTML elements ids.
        // replace them with dashes
        list = this.list,
        id, obj, vars, html;

    for (id in list) {
        if (list.hasOwnProperty(id)) {
            obj = list[id];
            // path should be HTML valid id
            obj.path = obj.path.replace(/\//g, '-');
        }
    }

    // render link
    // N.B. logic is way tricky to move to templates.
    // beside, this function is used as parameter in some Array#map() operations
    function link(obj, short, classes, area) {
        if (typeof obj === 'string') {
            obj = list[obj] || {
                id: obj
            };
        }

        // broken link. `options.brokenLinks` define action
        //if (!obj.path) { // Sometimes, obj.path can be broken; we'll resolve below
        //  return obj.id;
        /*if (options.brokenLinks === 'throw') {
        throw 'Link is broken: ' + obj.id;
      }
      return options.brokenLinks === 'show' ? '[[' + obj.id + ']]' : obj.id;*/
        //}
        var dotPos = obj.id.indexOf(".");
        var atPos = obj.id.indexOf("@");

        if (atPos >= 0) {
            obj.id = obj.id.replace("@", ".event.")
        }

        if (dotPos < 0 && obj.id.indexOf("new") < 0 && atPos < 0) {
            if (area == "ret") // from a return type; excludes constants and Void
            {
                var r = '<a href="' + obj.id + '.html"' + '" class="' + (classes || []).join(' ') + '" title="' + obj.id + (obj.type ? ' (' + obj.type + ')' : '') + '">' + obj.id + '</a>';
            }
            else // for the toc menu
            {
                if (obj.name === undefined) obj.name = obj.id;

                var r = '<a href="' + obj.id + '.html" id="' + obj.id + '" class="' + (classes || []).join(' ') + ' clicker" title="' + obj.id + (obj.type ? ' (' + obj.type + ')' : '') + '" data-id="' + obj.id + '">';
                r += typeof short === 'string' ? short : short ? obj.name.replace("_", " ") : obj.id;
                r += '</a>';
            }
        }
        else // for non-methods (constants, events, constructors); also for menu tabs up top
        {
            var undefinedName = false;
            if (obj.name == undefined) {
                obj.name = obj.id;
                undefinedName = true;
            }

            var filename;
            if (dotPos >= 0) {
                var names = obj.id.split(".");
                var numOfDots = names.length - 1;

                if (numOfDots > 1) // usually for subchildren, e.g. A.B.C
                filename = names[0] + "." + names[1];
                else {
                    if (obj.filename === undefined) // this really shouldn't happen.
                    filename = obj.id.substring(0, dotPos);
                    else filename = obj.filename.substring(0, obj.filename.indexOf('.'));
                }
            }
            else {
                filename = obj.filename.substring(0, obj.filename.indexOf('.'));
            }

            filename = filename.toLowerCase(); // maybe this is bad
            if (obj.path === undefined) obj.path = ""; // removes 'undefined' from window url
            var r = '<a href="' + filename.replace(/_/g, '.').replace(/new /g, '') + '.html#' + obj.path + '" class="' + (classes || []).join(' ') + '" title="' + obj.id + (obj.type ? ' (' + obj.type + ')' : '') + '" data-id="' + obj.id + '">';
            r += typeof short === 'string' ? short : short ? obj.name : obj.id;
            r += '</a>';

        }

        return format_ObjLink(r);
    }

    // convert markdown to HTML
    function markdown(text, inline) {
        var r, codes;

        r = md_conrefs.replaceConref(text);

        r = md2html(r);

        /* fixed
    // restore &entities;
    r = r.replace(/&amp;(\w+);/g, function (all, entity) {
      return '&' + entity + ';';
    });
    */
        /* considered wrong
    // trim content in <pre><code> CONTENT </code></pre>
    r = r.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, function (all, content) {
      return '<pre><code>' + content.trim() + '</code></pre>';
    });
    */
        // FIXME: highlight code
        /*r = r.replace(/<code>([\s\S]*?)<\/code>/g, function (all, content) {
      return '<code>' + highlight(content) + '</code>';
    });*/
        // inline markdown means to strip enclosing tag. <p /> in this case
        if (inline) {
            r = r.slice(3, -4);
        }
        // desugar [[foo#bar]] tokens into local links
        // N.B. in order to not apply conversion in <code> blocks,
        // we first store replace code blocks with nonces
        codes = {};
        r = r.replace(/(<code>[\s\S]*?<\/code>)/g, function (all, def) {
            var nonce = Math.random().toString().substring(2);
            codes[nonce] = def;
            return '@-=@=-@' + nonce + '@-=@=-@';
        });
        // convert [[link]] to links
        r = r.replace(/\[\[([\s\S]+?)\]\]/g, function (all, def) {
            def = def.split(/\s+/);
            id = def.shift();
            // invalid references don't produce links
            if (!list[id]) { // it's in a different file
                var filename;
                if (id.indexOf(".") >= 1) {
                    var dotPos = id.lastIndexOf(".");
                    filename = id.substring(0, dotPos) + ".html#" + id;
                }
                else if (id.indexOf("#") >= 1) {
                    var hashPos = id.lastIndexOf("#");
                    filename = id.substring(0, hashPos) + ".html#" + id;
                }
                else filename = id + ".html";

                var r = '<a href="' + filename + '">' + def + '</a>';
                return format_ObjLink(r);
                /*if (options.brokenLinks === 'throw') {
          throw 'Link is broken: ' + all + '\n' + r;
        }
        return options.brokenLinks === 'show' ? all : id;*/
            }
            //
            var obj = extend(list[id], {
                name: def.join(' ') || id
            });
            return link(obj, true, ['link-short']);
        });
        // restore code blocks, given previously stored nonces
        r = r.replace(/@-=@=-@(\d+)@-=@=-@/g, function (all, nonce) {
            return codes[nonce];
        });
        //
        return r;
    }

    // given signature object, recompose its textual representation
    function signature(obj, sig, type, id) {
        if (typeof obj === 'string') {
            obj = list[obj];
        }
        var r;
        // we want to highlight the member name to make it noticable; also, clickable, to expand the description
        if (obj.id.indexOf("new") >= 0) r = 'new <span id="' + id + '" class="member-name methodClicker">' + obj.id.substring(obj.id.indexOf(" ") + 1) + '</span>';
        else if (type != "callback" && type != "event") // clip off object name 
        r = '<span id="' + id + '" class="member-name methodClicker">' + obj.id.substring(obj.id.lastIndexOf(".") + 1) + '</span>';
        else if (type == "event") {
            var parts = obj.id.split(".");
            //var finalDot = obj.id.lastIndexOf(".");
            var eventName = parts.pop(); //obj.id.substring(obj.id.lastIndexOf("."));
            parts.pop();
            //obj.id.substring(0, finalDot)
            r = '<span class="eventObjName">' + parts.pop() + '</span><span class="eventListenerStart">' + '.on( </span>\"<span id="' + id + '" class="member-name methodClicker eventMember">' + eventName + '</span>\"';
        }
        else r = obj.id;

        if (sig.args) {
            if (type != 'event') r += '(';
            else r += ", <span class='eventFunctionOpen'>function( </span>"

            sig.args.forEach(function (sigArg, sigIdx, sigArgs) {
                var skip_first, a, value;
                // skip the first bound argument for prototype methods
                skip_first = obj.bound && obj.id.indexOf('#') >= 0;

                // turns the argument types into links
                if (obj.arguments && obj.arguments[sigIdx]) {
                    var link = "";

                    var currArg = obj.arguments[sigIdx];

                    if (currArg.name != sigArg.name) // in the event of, say, multiple signatures
                    {
                        var s;
                        for (s = 0; s < obj.arguments.length; s++) {
                            if (obj.arguments[s].name == sigArg.name) {
                                //console.log("swaped arg!");
                                currArg = obj.arguments[s];
                                break;
                            }
                        }
                        if (s == obj.arguments.length) {
                            //console.error("Couldn't find suitable argument replacement for " + currArg.name + " around " + obj.id);
                        }
                    }

                    currArg.types.forEach(function (currArgType, currIdx, currArgs) {
                        link += '<a href="' + currArgType + '.html">' + currArgType + '</a>';

                        if (currIdx < currArgs.length - 1) link += " | ";
                    });
                    a = link + " " + sigArg.name;
                }
                else a = sigArg.name;

                // argument can be callback
                if (sigArg.args) {
                    a = signature({
                        id: a
                    }, sigArg, "callback");
                }
                if (!sigIdx && skip_first) {
                    return; //a = '@' + a;
                }
                if (typeof sigArg.default_value !== 'undefined') {
                    // apply custom stringifier
                    value = JSON.stringify(sigArg.default_value, function (k, v) {
                        if (v instanceof RegExp) {
                            // FIXME: get rid of quotes, if possible
                            v = v.source;
                        }
                        else if (v === 'null') {
                            v = null;
                        }
                        return v;
                    });
                    a = a + ' = ' + value;
                }
                // compensate for possibly skipped first argument
                if (sigIdx > (skip_first ? 1 : 0)) {
                    a = ', ' + a;
                }
                if (sigArg.ellipsis) {
                    a += '...';
                }
                if (sigArg.optional) {
                    a = '[' + a + ']';
                }
                r += a;
            });
            if (type != "event") r += ')';
            else r += '<span class="eventFunctionClose"> ))</span>';
        }

        return format_ObjLink(r);
    }

    function format_ObjLink(l) {
        for (var o in globalObjs) {
            var obj = globalObjs[o];
            var re = new RegExp('href="' + obj + ".html", "ig");
            if (l.match(re)) {
                l = l.replace(re, 'href="' + options.docPath.replace("%s", obj));
            }
        }
        return l;
    }

    function format_name(name, level) {
        var names = name.split(">");

        return names[level - 1];
    }

    // collect context for rendering function
    vars = extend(options, {
        list: this.list,
        tree: this.tree,
        date: (new Date()).toUTCString(),
        //--
        link: link,
        markdown: markdown,
        signature: signature,
        format_name: format_name,
        outFile: this.outfile
    });

    // render HTML
    html = fn(vars);

    return [html, this.outfile];
};

function getGlobalObjs(objName) {
    if (objName == "js" || objName == "javascript") {
        return globalObjsJSON["javascript"];
    } // fill out more as time goes on
    else {
        console.error("I don't know any global objects for the type '" + objName + "'");
        process.exit(1);
    }
}
//
// export panino
//
module.exports = Panino;