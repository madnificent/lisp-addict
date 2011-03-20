Mojo.Log.info("Loading virtual machine");

/// credits

// The virtual machine was originally based on ideas and code from the
// books Paradigms of Artificial Intelligence Programming by Peter
// Norvig and Programming Erlang by Joe Armstrong.

/// global state

var globals = {};
var macros = {};
var sched = null;

var cyclecount = 0;
var deaths = [];

/// lisp types

var nil = function() {};
nil = new nil();

var string = function(value) {
	this.value = value;
};

var cons = function(a, b) {
	this.car = a;
	this.cdr = b;
};

var template = function(code) {
	this.code = code;
};

var func = function(template, env) {
	this.template = template;
	this.env = env;
};

var cell = function(x) {
	this.value = x;
};

var symbolp =   function(x) { return typeof(x) == "string"; };
var numberp =   function(x) { return typeof(x) == "number"; };
var nilp =      function(x) { return x === nil; };
var stringp =   function(x) { return x instanceof string; };
var consp =     function(x) { return x instanceof cons; };
var templatep = function(x) { return x instanceof template; };
var funcp =     function(x) { return x instanceof func; };
var cellp =     function(x) { return x instanceof cell; };
var arrayp =    function(x) { return x instanceof Array; };

/// primitive lisp data accessors

var symbolname = function(x) {
	if (!symbolp(x)) {
		throw "symbolname: type error";
	}
	return new string(x);
};

var car = function(x) {
	if (!consp(x)) {
		throw "car: type error";
	}
	return x.car;
};

var cdr = function(x) {
	if (!consp(x)) {
		throw "cdr: type error";
	}
	return x.cdr;
};

var setcar = function(c, x) {
	if (!consp(c)) {
		throw "setcar: type error";
	}
	c.car = x;
	return x;
};

var setcdr = function(c, x) {
	if (!consp(c)) {
		throw "setcdr: type error";
	}
	c.cdr = x;
	return x;
};

/// common list functions

var first = car;

var second = function(x) {
	return car(cdr(x));
};

var third = function(x) {
	return car(cdr(cdr(x)));
};

var list = function() {
	var i, x;
	if (arguments.length == 0) {
		return nil;
	}
	x = nil;
	for (i = arguments.length - 1; i >= 0; i--) {
		x = new cons(arguments[i], x);
	}
	return x;
};

var reverse = function(x) {
	var acc;
	for (acc = nil; !nilp(x); x = cdr(x)) {
		acc = new cons(car(x), acc);
	}
	return acc;
};

var map = function(x, f) {
	var fx;
	for (fx = nil; !nilp(x); x = cdr(x)) {
		fx = new cons(f(car(x)), fx);
	}
	return reverse(fx);
};

var foreach = function(x, f) {
	for (; !nilp(x); x = cdr(x)) {
		f(car(x));
	}
};

var array = function(x) {
	var a;
	for (a = []; !nilp(x); x = cdr(x)) {
		a.push(car(x));
	}
	return a;
};

/// interpreter

var finalret = function() {
	return {
		f: new template([
			new POP(),
			new CONST("normal"),
			new HALT()
		]),
		pc: 0,
		env: nil
	};
};

var machine = function(f) {
	this.f = f.template;
	this.pc = 0;
	this.env = f.env;
	this.stack = [];
	this.rstack = [finalret()];
	this.nargs = 0;
	this.status = "running";
};

machine.prototype.run = function(quota) {
	var instr, ncycles, exn;
	exn = null;
	try {
		for (ncycles = 0; ncycles < quota; ncycles++) {
			this.f.code[this.pc++].update(this);
			if (this.status != "running") {
				break;
			}
		}
	} catch (e) {
		exn = e;
	}
	return {ncycles: ncycles, exn: exn};
};

machine.prototype.recv = function(recvfn, args) {
	var self = this;
	if (this.status != "waiting") {
		throw "machine recv: not waiting for message";
	}
	this.nargs = 0;
	foreach(args, function(arg) {
		self.stack.push(arg);
		self.nargs++;
	});
	this.f = recvfn;
	this.pc = 0;
	this.status = "running";
};

machine.prototype.top = function() {
	return this.stack[this.stack.length - 1];
};

machine.prototype.frame = function(i) {
	var tail;
	for (tail = this.env; i > 0; i--) {
		tail = tail.cdr;
	}
	return tail.car;
};

machine.prototype.snapshot = function() {
	var i, n, x, ret;
	n = this.rstack.length;
	x = list(
		list("proc", sched.currentproc),
		list("env", unboxenv(this.env)),
		list("f", this.f),
		list("pc", this.pc)
	);
	for (i = 0; i < n; i++) {
		ret = this.rstack[i];
		x = new cons(list(
			"ret", ret.pc, ret.f,
			unboxenv(ret.env)
		), x);
	}
	return x;
};

var ARGS = function(nargs) {
	this.nargs = nargs;
};
ARGS.prototype = {
	op: "ARGS",
	update: function(m) {
		var i, frame;
		if (m.nargs != this.nargs) {
			throw "wrong number of arguments";
		}
		frame = new Array(m.nargs);
		for (i = m.nargs - 1; i >= 0; i--) {
			frame[i] = m.stack.pop();
		}
		m.env = new cons(frame, m.env);
	},
	sexp: function() {
		return list("ARGS", this.nargs);
	}
};

var ARGSD = function(nargs) {
	this.nargs = nargs;
};
ARGSD.prototype = {
	op: "ARGSD",
	update: function(m) {
		var i, frame, rnargs;
		if (m.nargs < this.nargs) {
			throw "too few arguments";
		}
		rnargs = this.nargs;
		frame = new Array(rnargs + 1);
		frame[rnargs] = nil;
		for (i = m.nargs; i > rnargs; i--) {
			frame[rnargs] = new cons(m.stack.pop(), frame[rnargs]);
		}
		for (i = rnargs - 1; i >= 0; i--) {
			frame[i] = m.stack.pop();
		}
		m.env = new cons(frame, m.env);
	},
	sexp: function() {
		return list("ARGSD", this.nargs);
	}
};

var LVAR = function(i, j, name) {
	this.i = i;
	this.j = j;
	this.name = name;
};
LVAR.prototype = {
	op: "LVAR",
	update: function(m) {
		m.stack.push(m.frame(this.i)[this.j]);
	},
	sexp: function() {
		return list("LVAR", this.i, this.j, this.name);
	}
};

var LSET = function(i, j, name) {
	this.i = i;
	this.j = j;
	this.name = name;
};
LSET.prototype = {
	op: "LSET",
	update: function(m) {
		m.frame(this.i)[this.j] = m.top();
	},
	sexp: function() {
		return list("LSET", this.i, this.j, this.name);
	}
};

var globalbinding = function(x) {
	this.value = x;
};

var GVAR = function(name) {
	this.name = name;
};
GVAR.prototype = {
	op: "GVAR",
	update: function(m) {
		var value;
		value = this.cache.value;
		if (value === null) {
			if (!(this.name in globals)) {
				throw "undefined global: " + this.name;
			}
			this.cache = globals[this.name];
			value = this.cache.value;
		}
		m.stack.push(value);
	},
	sexp: function() {
		return list("GVAR", this.name);
	},
	cache: new globalbinding(null)
};

var GSET = function(name) {
	this.name = name;
};
GSET.prototype = {
	op: "GSET",
	update: function(m) {
		if (this.cache.value === null) {
			if (!(this.name in globals)) {
				throw "undefined global: " + this.name;
			}
			this.cache = globals[this.name];
		}
		this.cache.value = m.top();
	},
	sexp: function() {
		return list("GSET", this.name);
	},
	cache: new globalbinding(null)
};

var POP = function() {
};
POP.prototype = {
	op: "POP",
	update: function(m) {
		m.stack.pop();
	},
	sexp: function() {
		return list("POP");
	}
};

var CONST = function(value) {
	this.value = value;
};
CONST.prototype = {
	op: "CONST",
	update: function(m) {
		m.stack.push(this.value);
	},
	sexp: function() {
		return list("CONST", this.value);
	}
};

var JUMP = function(label, pc) {
	this.label = label;
	this.pc = pc;
};
JUMP.prototype = {
	op: "JUMP",
	update: function(m) {
		m.pc = this.pc;
	},
	sexp: function() {
		return list("JUMP", this.label, this.pc);
	}
};

var FJUMP = function(label, pc) {
	this.label = label;
	this.pc = pc;
};
FJUMP.prototype = {
	op: "FJUMP",
	update: function(m) {
		if (nilp(m.stack.pop())) {
			m.pc = this.pc;
		}
	},
	sexp: function() {
		return list("FJUMP", this.label, this.pc);
	}
};

var TJUMP = function(label, pc) {
	this.label = label;
	this.pc = pc;
};
TJUMP.prototype = {
	op: "TJUMP",
	update: function(m) {
		if (!nilp(m.stack.pop())) {
			m.pc = this.pc;
		}
	},
	sexp: function() {
		return list("TJUMP", this.label, this.pc);
	}
};

var SAVE = function(label, pc) {
	this.label = label;
	this.pc = pc;
};
SAVE.prototype = {
	op: "SAVE",
	update: function(m) {
		m.rstack.push({
			f: m.f,
			env: m.env,
			pc: this.pc
		});
	},
	sexp: function() {
		return list("SAVE", this.label, this.pc);
	}
};

var RETURN = function() {
};
RETURN.prototype = {
	op: "RETURN",
	update: function(m) {
		var ret;
		ret = m.rstack.pop();
		m.f = ret.f;
		m.env = ret.env;
		m.pc = ret.pc;
	},
	sexp: function() {
		return list("RETURN");
	}
};

var CALLJ = function(nargs) {
	this.nargs = nargs;
};
CALLJ.prototype = {
	op: "CALLJ",
	update: function(m) {
		var f, args;
		f = m.stack.pop();
		if (templatep(f)) { // XXX: shim
			f = new func(f, nil);
		}
		if (!funcp(f)) {
			throw "cannot call nonfunction";
		}
		m.f = f.template;
		m.nargs = this.nargs;
		if (m.nargs == -1) {
			args = m.stack.pop();
			for (m.nargs = 0; !nilp(args); m.nargs++) {
				m.stack.push(car(args));
				args = cdr(args);
			}
		}
		m.env = f.env;
		m.pc = 0;
	},
	sexp: function() {
		return list("CALLJ", this.nargs);
	}
};

var FN = function(f) {
	this.f = f;
};
FN.prototype = {
	op: "FN",
	update: function(m) {
		m.stack.push(new func(this.f, m.env));
	},
	sexp: function() {
		return list("FN", this.f);
	}
};

var PRIM = function(name, prim) {
	this.name = name;
	this.prim = prim;
};
PRIM.prototype = {
	op: "PRIM",
	update: function(m) {
		m.stack.push(this.prim.apply(null, car(m.env)));
	},
	sexp: function() {
		return list("PRIM", this.name);
	}
};

var HALT = function() {
};
HALT.prototype = {
	op: "HALT",
	update: function(m) {
		sched.currentproc.die(m.top());
	},
	sexp: function() {
		return list("HALT");
	}
};

var RECV = function(r, timeout) {
	this.receivers = r;
	this.timeout = timeout;
};
RECV.prototype = {
	op: "RECV",
	update: function(m) {
		sched.currentproc.receivers = this.receivers;
		if (this.timeout) {
			sched.currentproc.settimeout(
				this.timeout.ms,
				this.timeout.f
			);
		}
		m.status = "waiting";
	},
	sexp: function() {
		var rs = nil, timeout = nil;
		if (this.timeout !== null) {
			timeout = list(this.timeout.ms, this.timeout.f);
		}
		for (tag in this.receivers) {
			rs = new cons(list(tag, this.receivers[tag]), rs);
		}
		return list("RECV", rs, timeout);
	}
};

/// code format

var boxinstr = function(x) {
	var instr, tab, timeout, construct;
	construct = function(op, args) {
		// FIXME: use of window object
		var f;
		f = function() {
			return window[op].apply(this, args);
		};
		f.prototype = window[op].prototype;
		return new f();
	};
	instr = construct(car(x), array(cdr(x)));
	if (instr instanceof FN) {
		instr.f = boxfn(instr.f);
	} else if (instr instanceof RECV) {
		tab = {};
		timeout = null;
		foreach(instr.receivers, function(r) {
			tab[first(r)] = boxfn(second(r));
		});
		if (instr.timeout && !nilp(instr.timeout)) {
			timeout = {
				ms: first(instr.timeout),
				f: boxfn(second(instr.timeout))
			};
		}
		instr.receivers = tab;
		instr.timeout = timeout;
	}
	return instr;
};

var unboxinstr = function(x) {
	return x.sexp();
};

var boxfn = function(x) {
	var code, instrs;
	if (templatep(x)) {
		return x;
	}
	if (funcp(x)) {
		return x.template;
	}
	foreach(x, function(pair) {
		switch (first(pair)) {
		case "code":
			instrs = second(pair);
			break;
		default:
			throw "boxfn: unexpected slot";
		}
	});
	code = array(map(instrs, boxinstr));
	return new template(code);
};

var unboxfn = function(f) {
	var instrs;
	if (funcp(f)) {
		return unboxfn(f.template);
	}
	if (!templatep(f)) {
		throw "unboxfn: type error";
	}
	instrs = list.apply(null, f.code);
	return list(
		list("code", map(instrs, unboxinstr))
	);
};

var unboxenv = function(env) {
	return map(env, function(a) {
		return list.apply(null, a);
	});
};

/// concurrency

var scheduler = function() {
	this.waitingp = true;
	this.procs = [];
	this.queue = [];
	this.currentproc = null;
	this.timeoutheap = new minheap(function(a, b) {
		return a.ms < b.ms;
	});
};

scheduler.prototype.onhalt = function(proc) {
	var i, n;
	n = this.procs.length;
	for (i = 0; i < n; i++) {
		if (this.procs[i] === proc) {
			this.procs.splice(i, 1);
			break;
		}
	}
};

scheduler.prototype.addprocess = function(proc) {
	this.procs.push(proc);
	this.queue.push(proc);
};

scheduler.prototype.addtimeout = function(timeout) {
	this.timeoutheap.insert(timeout);
};

scheduler.prototype.addmessage = function(msg) {
	this.queue.push(msg);
	if (this.waitingp) {
		this.run();
	}
};

scheduler.prototype.yield = function() {
	// FIXME: use of setTimeout
	var self = this;
	setTimeout(function() { self.run(); }, 0);
};

scheduler.prototype.setalarm = function() {
	// FIXME: use of setTimeout
	var self, ms;
	ms = timeoutheap.min().ms - now();
	if (ms < 0) {
		ms = 0;
	}
	self = this;
	setTimeout(function() { self.run(); }, ms);
	this.waitingp = true;
};

scheduler.prototype.awaitevent = function() {
	this.waitingp = true;
};

scheduler.prototype.execute = function(p, f, args) {
	sched.currentproc = p;
	p[f].apply(p, args);
	if (p.m.status == "running") {
		this.queue.push(p);
	}
};

scheduler.prototype.run = function() {
	var begin, task, p, timeout;
	begin = now();
	this.waitingp = false;
	while (now() - begin < 20) {
		if (!this.timeoutheap.emptyp()) {
			timeout = this.timeoutheap.min();
			if (timeout.canceledp) {
				this.timeoutheap.pop();
				continue;
			}
			if (now() >= timeout.ms) {
				this.timeoutheap.pop();
				this.execute(timeout.p, "expiretimeout", []);
				continue;
			}
		}
		if (this.queue.length == 0) {
			break;
		}
		task = this.queue.shift();
		if (processp(task)) {
			if (task.m.status == "halted") {
				continue;
			}
			this.execute(task, "run", [100]);
			continue;
		}
		if (messagep(task)) {
			this.execute(task.p, "recv", [task.msg]);
			continue;
		}
		throw "scheduler: unexpected task";
	}
	if (this.queue.length > 0) {
		this.yield();
		return;
	}
	if (!this.timeoutheap.emptyp()) {
		this.setalarm();
		return;
	}
	this.awaitevent();
};

scheduler.prototype.start = function(f) {
	this.addprocess(new proc(f));
	this.run();
};

var message = function(p, msg) {
	this.p = p;
	this.msg = msg;
};

var messagep = function(x) {
	return x instanceof message;
};

var sendmsg = function(p, msg) {
	sched.addmessage(new message(p, msg));
};

var minheap = function(lessp) {
	this.items = [null];
};

minheap.prototype.emptyp = function() {
	return this.items.length == 1;
};

minheap.prototype.min = function() {
	return this.items[1];
};

minheap.prototype.insert = function(item) {
	this.items.push(item);
	this.fixup();
};

minheap.prototype.pop = function() {
	var min;
	min = this.items[1];
	if (this.items.length == 2) {
		this.items.pop();
	} else {
		this.items[1] = this.items.pop();
		this.fixdown();
	}
	return min;
};

minheap.prototype.fixup = function() {
	var x, i, tmp;
	x = this.items;
	for (i = x.length - 1; i > 1; i = j) {
		j = Math.floor(i / 2);
		if (!lessp(x[i], x[j])) {
			break;
		}
		tmp = x[i];
		x[i] = x[j];
		x[j] = tmp;
	}
};

minheap.prototype.fixdown = function() {
	var x, n, i, j, tmp;
	x = this.items;
	n = x.length - 1;
	for (i = 1; 2 * i <= n; i = j) {
		j = 2 * i;
		if (j < n && lessp(x[j + 1], x[j])) {
			j++;
		}
		if (!lessp(x[j], x[i])) {
			break;
		}
		tmp = x[i];
		x[i] = x[j];
		x[j] = tmp;
	}
};

var processp = function(x) {
	return x instanceof proc;
};

var proc = function(f) {
	this.m = new machine(f);
	this.receivers = {};
	this.savequeue = [];
	this.mailbox = [];
	this.linkset = [];
	this.trapexitsp = false;
	this.timeout = null;
};

proc.prototype.link = function(p) {
	if (p.m.status == "halted") {
		throw "link fail";
	}
	this.linkset.push(p);
	p.linkset.push(this);
};

proc.prototype.unlink = function(p) {
	var i, n;
	n = this.linkset.length;
	for (i = 0; i < n; i++) {
		if (this.linkset[i] === p) {
			this.linkset.splice(i, 1);
			break;
		}
	}
};

proc.prototype.die = function(reason) {
	var i, n, p;
	if (this.m.status == "halted") {
		return;
	}
	deaths.push(reason);
	this.m.status = "halted";
	sched.onhalt(this);
	n = this.linkset.length;
	for (i = 0; i < n; i++) {
		p = this.linkset[i];
		if (p.trapexitsp) {
			p.unlink(this);
			sendmsg(p, list(
				"exit",
				this.m.snapshot(),
				reason
			));
			continue;
		}
		if (reason != "normal") {
			p.die(reason); // XXX stack overflow?
		}
	}
};

proc.prototype.kill = function() {
	this.die("killed");
};

proc.prototype.checkmail = function() {
	var msg, tag;
	if (this.m.status != "waiting") {
		throw "proc checkmail: not waiting";
	}
	while (this.mailbox.length > 0) {
		msg = this.mailbox.shift();
		tag = car(msg);
		if (tag in this.receivers) {
			if (this.timeout !== null) {
				this.timeout.canceled = true;
				this.timeout = null;
			}
			while (this.savequeue.length > 0) {
				sched.addmessage(
					this.savequeue.shift()
				);
			}
			this.m.recv(this.receivers[tag], cdr(msg));
			return;
		}
		this.savequeue.push(new message(this, msg));
	}
};

proc.prototype.run = function(quota) {
	var state;
	if (this.m.status != "running") {
		return 0;
	}
	state = this.m.run(quota);
	cyclecount += state.ncycles;
	if (state.exn !== null) {
		this.die(new string("exception: " + state.exn));
	}
	if (this.m.status == "waiting") {
		this.checkmail();
	}
	return state.ncycles;
};

proc.prototype.recv = function(msg) {
	this.mailbox.push(msg);
	if (this.m.status == "waiting") {
		this.checkmail();
	}
};

proc.prototype.expiretimeout = function() {
	var timeout;
	if (this.timeout === null) {
		return;
	}
	if (this.m.status != "waiting") {
		return;
	}
	this.checkmail();
	if (this.m.status != "waiting") {
		return;
	}
	timeout = this.timeout;
	this.timeout = null;
	while (this.savequeue.length > 0) {
		sched.addmessage(this.savequeue.shift());
	}
	this.m.recv(timeout.f, nil);
};

proc.prototype.settimeout = function(ms, f) {
	this.timeout = {
		p: this,
		ms: now() + ms,
		f: f,
		canceledp: false
	};
	sched.addtimeout(this.timeout);
};

var now = function() {
	return (new Date()).getTime();
};

/// primitives

var truth = function(x) {
	return x ? "t" : nil;
};

var predicate = function(f) {
	return function(x) {
		return truth(f(x));
	};
};

var mustbe = function(pred, x) {
	if (!pred(x)) {
		throw "type error";
	}
};

var bothmustbe = function(pred, a, b) {
	mustbe(pred, a);
	mustbe(pred, b);
};

var primadd = function(a, b) { bothmustbe(numberp, a, b); return a + b; };
var primsub = function(a, b) { bothmustbe(numberp, a, b); return a - b; };
var primmul = function(a, b) { bothmustbe(numberp, a, b); return a * b; };
var primdiv = function(a, b) { bothmustbe(numberp, a, b); return a / b; };

var primdef = function(sym) {
	if (sym in globals) {
		return;
	}
	globals[sym] = new globalbinding(sym);
	return sym;
};

var primundef = function(sym) {
	if (sym in globals) {
		globals[sym].value = null;
		delete globals[sym];
	}
	return sym;
};

var primmac = function(sym) {
	macros[sym] = true;
	return sym;
};

var primunmac = function(sym) {
	delete macros[sym];
	return sym;
};

var primlt = function(a, b) { bothmustbe(numberp, a, b); return truth(a < b); };
var primgt = function(a, b) { bothmustbe(numberp, a, b); return truth(a > b); };
var primle = function(a, b) { bothmustbe(numberp, a, b); return truth(a <= b); };
var primge = function(a, b) { bothmustbe(numberp, a, b); return truth(a >= b); };

var primeq = function(a, b) {
	if (stringp(a) && stringp(b)) {
		return truth(a.value === b.value);
	}
	return truth(a === b);
};

var primneq = function(a, b) {
	if (stringp(a) && stringp(b)) {
		return truth(a.value !== b.value);
	}
	return truth(a !== b);
};

var primsymbolp = predicate(symbolp);
var primnumberp = predicate(numberp);
var primstringp = predicate(stringp);
var primconsp = predicate(consp);
var primtemplatep = predicate(templatep);
var primfunctionp = predicate(funcp);
var primprocessp = predicate(processp);
var primcellp = predicate(cellp);
var primarrayp = predicate(arrayp);

var primsymbolname = symbolname;
var primcons = function(a, b) { return new cons(a, b); };
var primcar = car;
var primcdr = cdr;
var primsetcar = setcar;
var primsetcdr = setcdr;

var primcellnew = function(x) {
	return new cell(x);
};

var primcellget = function(c) {
	mustbe(cellp, c);
	return c.value;
};

var primcellput = function(c, x) {
	mustbe(cellp, c);
	c.value = x;
	return x;
};

var primarraynew = function(n) {
	mustbe(numberp, n);
	return new Array(n);
};

var primarraylength = function(arr) {
	mustbe(arrayp, arr);
	return arr.length;
};

var primarrayget = function(arr, i) {
	mustbe(arrayp, arr);
	mustbe(numberp, i);
	if (i < 0 || arr.length <= i) {
		throw "arrayget: index out of bounds";
	}
	return arr[i] || nil;
};

var primarrayput = function(arr, i, x) {
	mustbe(arrayp, arr);
	mustbe(numberp, i);
	if (i < 0 || arr.length <= i) {
		throw "arrayput: index out of bounds";
	}
	arr[i] = x;
	return arr;
};

var primarrayresize = function(arr, n) {
	mustbe(arrayp, arr);
	mustbe(numberp, n);
	if (n < 0) {
		throw "arrayresize: negative size";
	}
	arr.length = n;
	return arr;
};

var primsubstringp = function(sub, str) {
	var substringp;
	substringp = function(a, b) {
		return b.indexOf(a, 0) != -1;
	};
	bothmustbe(stringp, sub, str);
	return truth(substringp(sub.value, str.value));
};

var primsref = function(s, i) {
	mustbe(stringp, s);
	mustbe(numberp, i);
	if (i < 0 || s.value.length <= i) {
		throw "sref: bad index";
	}
	return new string(s.value[i]);
};

var primslength = function(s) {
	mustbe(stringp, s);
	return s.value.length;
};

var primstrcat = function(args) {
	var s;
	s = "";
	foreach(args, function(arg) {
		mustbe(stringp, arg);
		s += arg.value;
	});
	return new string(s);
};

var primsubstring = function(s, begin, end) {
	mustbe(stringp, s);
	return new string(s.value.substring(begin, end));
};

var primatoi = function(a) {
	var n;
	mustbe(stringp, a);
	n = Number(a.value);
	if (isNaN(n)) {
		return nil;
	}
	return n;
};

var primitoa = function(i) {
	mustbe(numberp, i);
	return new string("" + i);
};

var primintern = function(s) {
	mustbe(stringp, s);
	return s.value;
};

var primthrow = function(x) {
	mustbe(stringp, x);
	throw x.value;
};

var primglobal = function(name) {
	if (name in globals) {
		return globals[name].value;
	}
	throw "undefined global";
};

var primmacrop = function(name) {
	return truth(name in macros);
};

var primboxfn = boxfn;
var primunboxfn = unboxfn;

var primlog = function(msg) {
	// FIXME: DOM user
	var node;
	mustbe(stringp, msg);
	node = $("textout")
	node.value += msg.value + "\n";
	node.scrollTop = node.scrollHeight;
	return nil;
};

var primsnapshot = function(p) {
	mustbe(processp, p);
	return p.m.snapshot();
};

var primspawn = function(f) {
	var p;
	mustbe(funcp, f);
	p = new proc(f);
	sched.addprocess(p);
	return p;
};

var primspawnlink = function(f) {
	var p;
	mustbe(funcp, f);
	p = primspawn(f);
	p.link(sched.currentproc);
	return p;
};

var primtrapexits = function() {
	sched.currentproc.trapexitsp = true;
	return nil;
};

var primsendmsg = function(p, msg) {
	mustbe(processp, p);
	mustbe(consp, msg);
	mustbe(symbolp, car(msg));
	sendmsg(p, msg);
	return nil;
};

var primself = function() {
	return sched.currentproc;
};

var primprocs = function() {
	return list.apply(null, sched.procs);
};

var primkill = function(p) {
	mustbe(processp, p);
	p.kill();
	return nil;
};

var primglobals = function() {
	var name, x = nil;
	for (name in globals) {
		x = new cons(name, x);
	}
	return x;
};

var primcyclecount = function() {
	return cyclecount;
};

var primnow = function() {
	return now();
};

var xhrget = function(url, f) {
	var xhr;
	xhr = new XMLHttpRequest();
	xhr.open("GET", url, true);
	xhr.onreadystatechange = function(e) {
		if (xhr.readyState == 4) {
			if (xhr.status == 200) {
			        f(200, xhr.responseText);
			} else {
				f(xhr.status, "");
			}
		}
	};
	xhr.send(null);
};

var xhrpost = function(url, text, f) {
	var xhr;
	xhr = new XMLHttpRequest();
	xhr.open("POST", url, true);
	xhr.onreadystatechange = function(e) {
		if (xhr.readyState == 4) {
		        f(xhr.status);
		}
	};
	xhr.send(text);
};

var xhrput = function(url, text, f) {
	var xhr;
	xhr = new XMLHttpRequest();
	xhr.open("PUT", url, true);
	xhr.onreadystatechange = function(e) {
		if (xhr.readyState == 4) {
		        f(xhr.status);
		}
	};
	xhr.send(text);
};

var primhttp = function(method, url, args) {
	var p;
	mustbe(symbolp, method);
	mustbe(stringp, url);
	p = sched.currentproc;
	switch (method) {
	case "get":
		if (!nilp(args)) {
			throw "net: wrong number of arguments";
		}
		xhrget(url.value, function(code, text) {
			sched.addmessage(new message(
				p, list("response", code, new string(text))
			));
		});
		break;
	case "post":
		if (!nilp(cdr(args))) {
			throw "net: wrong number of arguments";
		}
		mustbe(stringp, car(args));
		xhrpost(url.value, car(args).value, function(code) {
			sched.addmessage(new message(
				p, list("response", code)
			));
		});
		break;
	case "put":
		if (!nilp(cdr(args))) {
			throw "net: wrong number of arguments";
		}
		mustbe(stringp, car(args));
		xhrput(url.value, car(args).value, function(code) {
			sched.addmessage(new message(
				p, list("response", code)
			));
		});
		break;
	default:
		throw "net: unknown method";
	}
	return nil;
};

var primfromjson = function(s) {
	mustbe(stringp, s);
	return fromjson(eval(s.value));
};

var primrand = function() {
	return Math.random();
};

var primfloor = function(n) {
	mustbe(numberp, n);
	return Math.floor(n);
};

var makecallback = function(f) {
	var code;
	code = [
		new ARGS(1),
		new PRIM("", f),
		new RETURN()
	];
	return new func(new template(code), nil);
};

var primgiveup = function(p) {
	mustbe(processp, p);
	enslave(function(s, f) {
		sched.addmessage(new message(p, list(
			"eval",
			new string(s),
			makecallback(function(s) {
				f(s.value);
				return nil;
			})
		)));
	});
	return nil;
};

var eventsexp = function(e) {
	// FIXME: DOM user
	switch (e.type) {
	case "keyup":
	case "keydown":
		return list(e.type, e.keyCode);
	case "click":
		if (!("id" in e.target)) {
			throw "eventsexp: unknown id";
		}
		return list("click", e.target.id);
	case "change":
		if (!("id" in e.target)) {
			throw "eventsexp: unknown id";
		}
		return list("change", e.target.id, new string(e.target.value));
	default:
		throw "eventsexp: unknown event type";
	}
};

var postlistener = function(node, event) {
	// FIXME: DOM user
	var f, p;
	mustbe(symbolp, event);
	p = sched.currentproc;
	f = function(e) {
		sched.addmessage(new message(p, eventsexp(e)));
	};
	node.addEventListener(event, f, false);
};

var $ = function(x) {
	// FIXME: DOM user
	return document.getElementById(x);
};

var primdoc = function(req) {
	// FIXME: DOM user
	var method, resource, body, node;
	method = first(req);
	resource = second(req);
	body = nil;
	if (consp(cdr(cdr(req)))) {
		body = third(req);
	}
	mustbe(symbolp, method);
	mustbe(consp, resource);
	mustbe(symbolp, car(resource));
	mustbe(consp, cdr(resource));
	mustbe(symbolp, second(resource));
	if (car(resource) == "body") {
		node = document;
	} else {
		node = $(car(resource));
	}
	if (!node) {
		throw "doc: no such resource " + car(resource);
	}
	switch (method) {
	case "get":
		if (second(resource) == "value") {
			return new string(node.value);
		}
		throw "doc: no such resource";
	case "put":
		if (second(resource) == "value") {
			mustbe(stringp, body);
			node.value = body.value;
			return nil;
		}
		throw "doc: no such resource";
	case "post":
		switch (second(resource)) {
		case "value":
			mustbe(stringp, body);
			node.value += body.value;
			return nil;
		case "listeners":
			postlistener(node, body);
			return nil;
		}
		throw "doc: no such resource";
	default:
		throw "doc: unknown method";
	}
};

var fprimrenames = {
	"+": "add",
	"-": "sub",
	"*": "mul",
	"/": "div",
	"<": "lt",
	">": "gt",
	"<=": "le",
	">=": "ge",
	"=": "eq",
	"!=": "neq"
};

var fprims = [
	"+ a b",
	"- a b",
	"* a b",
	"/ a b",
	"< a b",
	"> a b",
	"<= a b",
	">= a b",
	"= a b",
	"!= a b",
	"numberp x",
	"symbolp x",
	"consp x",
	"templatep x",
	"functionp x",
	"stringp x",
	"processp x",
	"cellp x",
	"arrayp x",
	"symbolname sym",
	"cons a b",
	"car c",
	"cdr c",
	"setcar c x",
	"setcdr c x",
	"cellnew x",
	"cellget c",
	"cellput c x",
	"arraynew n",
	"arraylength arr",
	"arrayget arr i",
	"arrayput arr i x",
	"arrayresize n",
	"def sym",
	"undef sym",
	"mac sym",
	"unmac sym",
	"symbolp x",
	"strcat . strings",
	"substringp sub str",
	"sref s i",
	"slength s",
	"substring s a z",
	"atoi a",
	"itoa i",
	"intern s",
	"throw x",
	"global name",
	"macrop name",
	"boxfn alist",
	"unboxfn f",
	"log msg",
	"snapshot name",
	"spawn f",
	"spawnlink f",
	"trapexits",
	"sendmsg p msg",
	"self",
	"procs",
	"kill p",
	"globals",
	"cyclecount",
	"now",
	"http method url . args",
	"fromjson s",
	"rand",
	"floor n",
	"giveup p",
	"doc . req"
];

var mprims = [
	["exit reason", [
		new ARGS(1),
		new LVAR(0, 0, "reason"),
		new HALT()
	]],
	["apply f args", [
		new ARGS(2),
		new LVAR(0, 1, "args"),
		new LVAR(0, 0, "f"),
		new CALLJ(-1)
	]]
];

var readargs = function(s) {
	var x, atoms, i, n;
	x = nil;
	atoms = s.split(" ");
	n = atoms.length;
	if (n >= 3) {
		if (atoms[n - 2] == ".") {
			x = atoms[n - 1];
			n -= 2;
		}
	}
	for (i = n - 1; i >= 0; i--) {
		x = new cons(atoms[i], x);
	}
	return x;
};

var loadfprims = function() {
	// FIXME: window user
	// put fprims onto the end of mprims
	var i, n, f, form, name, args, nargs, dottedp;
	n = fprims.length;
	for (i = 0; i < n; i++) {
		form = readargs(fprims[i]);
		name = first(form);
		args = cdr(form);
		for (nargs = 0; consp(args); args = cdr(args)) {
			nargs++;
		}
		dottedp = !nilp(args);
		if (name in fprimrenames) {
			name = fprimrenames[name];
		}
		f = window["prim" + name];
		if (!f) {
			throw "no such prim: \"" + name + "\"";
		}
		mprims.push([
			fprims[i],
			[
				(dottedp ? new ARGSD(nargs) : new ARGS(nargs)),
				new PRIM(name, f),
				new RETURN()
			]
		]);
	}
};

var loadmprims = function() {
	var i, n, r, form, code, name, f;
	n = mprims.length;
	for (i = 0; i < n; i++) {
		form = readargs(mprims[i][0]);
		code = mprims[i][1];
		name = first(form);
		f = new template(code);
		globals[name] = new globalbinding(new func(f, nil));
	}
};

/// loading

var fromjson = function(x) {
	var e, i, n;
	if (typeof(x) == "number") {
		return x;
	}
	if (typeof(x) == "string") {
		return x;
	}
	if ("s" in x) {
		return new string(x.s);
	}
	if ("d" in x) {
		n = x.d.length;
		e = fromjson(x.d[n - 1]);
		for (i = n - 2; i >= 0; i--) {
			e = new cons(fromjson(x.d[i]), e);
		}
		return e;
	}
	n = x.length;
	e = nil;
	for (i = n - 1; i >= 0; i--) {
		e = new cons(fromjson(x[i]), e);
	}
	return e;
};

var execute = function(json) {
	var f;
	f = boxfn(fromjson(json.pop()));
	while (json.length > 0) {
		f = new template([
			new ARGS(0),
			new SAVE("L0", 4),
			new FN(boxfn(fromjson(json.pop()))),
			new CALLJ(0),
			new FN(f),
			new CALLJ(0)
		]);
	}
	sched = new scheduler();
	sched.start(new func(f, nil));
};

var load = function() {
    Mojo.Log.info("loading fprims");
	loadfprims();
    Mojo.Log.info("loading mprims");
	loadmprims();
    Mojo.Log.info("executing bytecode: " + compiledcode != null );
        execute(compiledcode);
};

Mojo.Log.info("Loaded virtual machine");
