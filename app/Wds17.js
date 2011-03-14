/// enslave: this function is provided by the stage
// var enslave = function(lisp) {
//     Mojo.Log.error("Enslave was called before the system published it");
// };

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
	loadfprims();
	loadmprims();
	execute(compiledcode);
	//xhrget("boot.fasl", function(code, text) {
	//	execute(eval(text));
	//});
};

/// compiled lisp code

var compiledcode = [
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","position"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L7",8],["CONST",-1],["RETURN"],["SAVE","L2",13],["LVAR",0,1,"tail"],["LVAR",2,0,"item"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L6",16],["LVAR",0,0,"i"],["RETURN"],["GVAR","t"],["FJUMP","L5",29],["SAVE","L3",23],["LVAR",0,0,"i"],["CONST",1],["GVAR","+"],["CALLJ",2],["SAVE","L4",27],["LVAR",0,1,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["LSET",0,0,"loop"],["POP"],["CONST",0],["LVAR",1,1,"items"],["LVAR",0,0,"loop"],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","position"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","inenvp"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L8",8],["CONST",[]],["RETURN"],["SAVE","L3",16],["LVAR",2,0,"name"],["SAVE","L2",14],["LVAR",0,1,"tail"],["GVAR","car"],["CALLJ",1],["GVAR","position"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L4",6],["LVAR",0,0,"j"],["CONST",0],["GVAR",">="],["CALLJ",2],["FJUMP","L7",11],["LVAR",1,0,"i"],["LVAR",0,0,"j"],["GVAR","cons"],["CALLJ",2],["SAVE","L5",16],["LVAR",1,0,"i"],["CONST",1],["GVAR","+"],["CALLJ",2],["SAVE","L6",20],["LVAR",1,1,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",2,0,"loop"],["CALLJ",2]]]]],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["CONST",0],["LVAR",1,1,"env"],["LVAR",0,0,"loop"],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","inenvp"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","gen"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",0],["LVAR",0,0,"x"],["GVAR","list"],["CALLJ",1]]]]],["GSET","gen"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","genvar"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",6],["LVAR",0,0,"name"],["LVAR",0,1,"env"],["GVAR","inenvp"],["CALLJ",2],["FN",[["code",[["ARGS",1],["LVAR",0,0,"p"],["FJUMP","L4",15],["CONST","LVAR"],["SAVE","L2",8],["LVAR",0,0,"p"],["GVAR","car"],["CALLJ",1],["SAVE","L3",12],["LVAR",0,0,"p"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"name"],["GVAR","gen"],["CALLJ",4],["CONST","GVAR"],["LVAR",1,0,"name"],["GVAR","gen"],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","genvar"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","genset"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",6],["LVAR",0,0,"name"],["LVAR",0,1,"env"],["GVAR","inenvp"],["CALLJ",2],["FN",[["code",[["ARGS",1],["LVAR",0,0,"p"],["FJUMP","L4",15],["CONST","LSET"],["SAVE","L2",8],["LVAR",0,0,"p"],["GVAR","car"],["CALLJ",1],["SAVE","L3",12],["LVAR",0,0,"p"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"name"],["GVAR","gen"],["CALLJ",4],["CONST","GSET"],["LVAR",1,0,"name"],["GVAR","gen"],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","genset"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","genargs"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L16",10],["CONST","ARGS"],["LVAR",0,0,"nargs"],["GVAR","gen"],["CALLJ",2],["SAVE","L2",14],["LVAR",0,1,"tail"],["GVAR","symbolp"],["CALLJ",1],["FJUMP","L15",19],["CONST","ARGSD"],["LVAR",0,0,"nargs"],["GVAR","gen"],["CALLJ",2],["SAVE","L10",40],["SAVE","L3",24],["LVAR",0,1,"tail"],["GVAR","consp"],["CALLJ",1],["FJUMP","L8",37],["SAVE","L5",32],["SAVE","L4",30],["LVAR",0,1,"tail"],["GVAR","car"],["CALLJ",1],["GVAR","symbolp"],["CALLJ",1],["FJUMP","L6",35],["GVAR","t"],["JUMP","L7",36],["CONST",[]],["JUMP","L9",38],["CONST",[]],["GVAR","not"],["CALLJ",1],["FJUMP","L14",44],["CONST",{s:"genargs: incorrect argument expression"}],["GVAR","throw"],["CALLJ",1],["GVAR","t"],["FJUMP","L13",57],["SAVE","L11",51],["LVAR",0,0,"nargs"],["CONST",1],["GVAR","+"],["CALLJ",2],["SAVE","L12",55],["LVAR",0,1,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["LSET",0,0,"loop"],["POP"],["CONST",0],["LVAR",1,0,"args"],["LVAR",0,0,"loop"],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","genargs"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","seq"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",0],["SAVE","L1",5],["LVAR",0,0,"seqs"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L5",8],["CONST",[]],["RETURN"],["SAVE","L2",12],["LVAR",0,0,"seqs"],["GVAR","car"],["CALLJ",1],["SAVE","L4",20],["GVAR","seq"],["SAVE","L3",18],["LVAR",0,0,"seqs"],["GVAR","cdr"],["CALLJ",1],["GVAR","apply"],["CALLJ",2],["GVAR","append"],["CALLJ",2]]]]],["GSET","seq"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","comppop"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L2",9],["LVAR",0,0,"context"],["SAVE","L1",7],["CONST","valuep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FJUMP","L3",12],["CONST",[]],["RETURN"],["CONST","POP"],["GVAR","gen"],["CALLJ",1]]]]],["GSET","comppop"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compret"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L2",9],["LVAR",0,0,"context"],["SAVE","L1",7],["CONST","morep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FJUMP","L3",12],["CONST",[]],["RETURN"],["CONST","RETURN"],["GVAR","gen"],["CALLJ",1]]]]],["GSET","compret"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compvar"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L2",9],["LVAR",0,1,"context"],["SAVE","L1",7],["CONST","valuep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FJUMP","L7",28],["SAVE","L5",22],["LVAR",0,0,"name"],["SAVE","L4",20],["LVAR",0,1,"context"],["SAVE","L3",18],["CONST","env"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["GVAR","genvar"],["CALLJ",2],["SAVE","L6",26],["LVAR",0,1,"context"],["GVAR","compret"],["CALLJ",1],["GVAR","seq"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["GSET","compvar"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compconst"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L2",9],["LVAR",0,1,"context"],["SAVE","L1",7],["CONST","valuep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FJUMP","L5",21],["SAVE","L3",15],["CONST","CONST"],["LVAR",0,0,"value"],["GVAR","gen"],["CALLJ",2],["SAVE","L4",19],["LVAR",0,1,"context"],["GVAR","compret"],["CALLJ",1],["GVAR","seq"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["GSET","compconst"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compif"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",4],["SAVE","L5",22],["LVAR",0,0,"pred"],["SAVE","L4",20],["SAVE","L3",17],["SAVE","L1",10],["CONST","valuep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["SAVE","L2",15],["CONST","morep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["GVAR","list"],["CALLJ",2],["LVAR",0,3,"context"],["GVAR","append"],["CALLJ",2],["GVAR","comp"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L6",5],["LVAR",0,0,"pcode"],["GVAR","singlep"],["CALLJ",1],["FJUMP","L11",19],["SAVE","L8",14],["SAVE","L7",11],["LVAR",0,0,"pcode"],["GVAR","car"],["CALLJ",1],["CONST","CONST"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L9",17],["GVAR","t"],["JUMP","L10",18],["CONST",[]],["JUMP","L12",20],["CONST",[]],["FJUMP","L41",40],["SAVE","L15",31],["SAVE","L14",29],["SAVE","L13",27],["LVAR",0,0,"pcode"],["GVAR","car"],["CALLJ",1],["GVAR","second"],["CALLJ",1],["GVAR","nilp"],["CALLJ",1],["FJUMP","L16",36],["LVAR",1,2,"fform"],["LVAR",1,3,"context"],["GVAR","comp"],["CALLJ",2],["LVAR",1,1,"tform"],["LVAR",1,3,"context"],["GVAR","comp"],["CALLJ",2],["SAVE","L17",45],["LVAR",1,1,"tform"],["LVAR",1,3,"context"],["GVAR","comp"],["CALLJ",2],["SAVE","L18",50],["LVAR",1,2,"fform"],["LVAR",1,3,"context"],["GVAR","comp"],["CALLJ",2],["SAVE","L21",61],["LVAR",1,3,"context"],["SAVE","L20",59],["SAVE","L19",57],["CONST","genlabel"],["GVAR","list"],["CALLJ",1],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["SAVE","L23",69],["LVAR",1,3,"context"],["SAVE","L22",67],["CONST","morep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FJUMP","L27",82],["SAVE","L26",81],["LVAR",1,3,"context"],["SAVE","L25",79],["SAVE","L24",77],["CONST","genlabel"],["GVAR","list"],["CALLJ",1],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["JUMP","L28",83],["CONST",[]],["FN",[["code",[["ARGS",4],["LVAR",1,0,"pcode"],["SAVE","L29",7],["CONST","FJUMP"],["LVAR",0,2,"k1"],["GVAR","gen"],["CALLJ",2],["LVAR",0,0,"tcode"],["SAVE","L31",16],["LVAR",2,3,"context"],["SAVE","L30",14],["CONST","morep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FJUMP","L33",23],["SAVE","L32",22],["CONST","JUMP"],["LVAR",0,3,"k2"],["GVAR","gen"],["CALLJ",2],["JUMP","L34",24],["CONST",[]],["SAVE","L35",28],["LVAR",0,2,"k1"],["GVAR","list"],["CALLJ",1],["LVAR",0,1,"fcode"],["SAVE","L37",37],["LVAR",2,3,"context"],["SAVE","L36",35],["CONST","morep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FJUMP","L39",43],["SAVE","L38",42],["LVAR",0,3,"k2"],["GVAR","list"],["CALLJ",1],["JUMP","L40",44],["CONST",[]],["GVAR","seq"],["CALLJ",7]]]]],["CALLJ",4]]]]],["CALLJ",1]]]]],["GSET","compif"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compargs"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,0,"exps"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L10",8],["CONST",[]],["RETURN"],["SAVE","L7",32],["SAVE","L2",13],["LVAR",0,0,"exps"],["GVAR","car"],["CALLJ",1],["SAVE","L6",30],["SAVE","L5",27],["SAVE","L3",20],["CONST","valuep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["SAVE","L4",25],["CONST","morep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["GVAR","list"],["CALLJ",2],["LVAR",0,1,"context"],["GVAR","append"],["CALLJ",2],["GVAR","comp"],["CALLJ",2],["SAVE","L9",40],["SAVE","L8",37],["LVAR",0,0,"exps"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","compargs"],["CALLJ",2],["GVAR","seq"],["CALLJ",2]]]]],["GSET","compargs"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compcall"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",3],["SAVE","L1",5],["LVAR",0,0,"f"],["GVAR","consp"],["CALLJ",1],["FJUMP","L10",29],["SAVE","L3",14],["SAVE","L2",11],["LVAR",0,0,"f"],["GVAR","car"],["CALLJ",1],["CONST","lambda"],["GVAR","="],["CALLJ",2],["FJUMP","L8",27],["SAVE","L5",22],["SAVE","L4",20],["LVAR",0,0,"f"],["GVAR","second"],["CALLJ",1],["GVAR","nilp"],["CALLJ",1],["FJUMP","L6",25],["GVAR","t"],["JUMP","L7",26],["CONST",[]],["JUMP","L9",28],["CONST",[]],["JUMP","L11",30],["CONST",[]],["FJUMP","L35",49],["SAVE","L12",35],["LVAR",0,1,"args"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L15",46],["SAVE","L14",43],["SAVE","L13",41],["LVAR",0,0,"f"],["GVAR","cdr"],["CALLJ",1],["GVAR","cdr"],["CALLJ",1],["LVAR",0,2,"context"],["GVAR","compbegin"],["CALLJ",2],["CONST",{s:"compcall: unexpected arguments"}],["GVAR","throw"],["CALLJ",1],["SAVE","L24",86],["SAVE","L16",55],["LVAR",0,1,"args"],["LVAR",0,2,"context"],["GVAR","compargs"],["CALLJ",2],["SAVE","L21",76],["LVAR",0,0,"f"],["SAVE","L20",74],["SAVE","L19",71],["SAVE","L17",64],["CONST","valuep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["SAVE","L18",69],["CONST","morep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["GVAR","list"],["CALLJ",2],["LVAR",0,2,"context"],["GVAR","append"],["CALLJ",2],["GVAR","comp"],["CALLJ",2],["SAVE","L23",84],["CONST","CALLJ"],["SAVE","L22",82],["LVAR",0,1,"args"],["GVAR","length"],["CALLJ",1],["GVAR","gen"],["CALLJ",2],["GVAR","seq"],["CALLJ",3],["FN",[["code",[["ARGS",1],["SAVE","L27",12],["SAVE","L26",10],["LVAR",1,2,"context"],["SAVE","L25",8],["CONST","morep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["GVAR","not"],["CALLJ",1],["FJUMP","L34",15],["LVAR",0,0,"tailcode"],["RETURN"],["SAVE","L30",26],["LVAR",1,2,"context"],["SAVE","L29",24],["SAVE","L28",22],["CONST","genlabel"],["GVAR","list"],["CALLJ",1],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L31",6],["CONST","SAVE"],["LVAR",0,0,"k"],["GVAR","gen"],["CALLJ",2],["LVAR",1,0,"tailcode"],["SAVE","L32",11],["LVAR",0,0,"k"],["GVAR","list"],["CALLJ",1],["SAVE","L33",15],["LVAR",2,2,"context"],["GVAR","comppop"],["CALLJ",1],["GVAR","seq"],["CALLJ",4]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","compcall"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","partition"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",3],["SAVE","L1",5],["LVAR",0,2,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L12",10],["LVAR",0,0,"yes"],["LVAR",0,1,"no"],["GVAR","list"],["CALLJ",2],["SAVE","L3",17],["SAVE","L2",15],["LVAR",0,2,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,1,"pred"],["CALLJ",1],["FJUMP","L11",33],["SAVE","L5",26],["SAVE","L4",23],["LVAR",0,2,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",0,0,"yes"],["GVAR","cons"],["CALLJ",2],["LVAR",0,1,"no"],["SAVE","L6",31],["LVAR",0,2,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",3],["GVAR","t"],["FJUMP","L10",50],["LVAR",0,0,"yes"],["SAVE","L8",44],["SAVE","L7",41],["LVAR",0,2,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",0,1,"no"],["GVAR","cons"],["CALLJ",2],["SAVE","L9",48],["LVAR",0,2,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",3],["CONST",[]],["RETURN"]]]]],["LSET",0,0,"loop"],["POP"],["CONST",[]],["CONST",[]],["LVAR",1,0,"x"],["LVAR",0,0,"loop"],["CALLJ",3]]]]],["CALLJ",1]]]]],["GSET","partition"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compreceive"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L2",6],["LVAR",0,0,"clauses"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"c"],["GVAR","caar"],["CALLJ",1],["CONST","after"],["GVAR","="],["CALLJ",2]]]]],["GVAR","partition"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L4",8],["SAVE","L3",6],["LVAR",0,0,"part"],["GVAR","car"],["CALLJ",1],["GVAR","nilp"],["CALLJ",1],["FJUMP","L6",11],["CONST",[]],["JUMP","L7",15],["SAVE","L5",15],["LVAR",0,0,"part"],["GVAR","caar"],["CALLJ",1],["SAVE","L8",19],["LVAR",0,0,"part"],["GVAR","second"],["CALLJ",1],["FN",[["code",[["ARGS",2],["LVAR",0,0,"after"],["FJUMP","L14",25],["SAVE","L13",22],["SAVE","L10",11],["SAVE","L9",9],["LVAR",0,0,"after"],["GVAR","car"],["CALLJ",1],["GVAR","second"],["CALLJ",1],["SAVE","L12",20],["CONST",[]],["SAVE","L11",17],["LVAR",0,0,"after"],["GVAR","cdr"],["CALLJ",1],["LVAR",2,1,"context"],["GVAR","complambda"],["CALLJ",3],["GVAR","list"],["CALLJ",2],["LSET",0,0,"after"],["POP"],["JUMP","L15",25],["SAVE","L20",30],["FN",[["code",[["ARGS",1],["SAVE","L16",5],["LVAR",0,0,"c"],["GVAR","caar"],["CALLJ",1],["SAVE","L19",17],["SAVE","L17",10],["LVAR",0,0,"c"],["GVAR","cdar"],["CALLJ",1],["SAVE","L18",14],["LVAR",0,0,"c"],["GVAR","cdr"],["CALLJ",1],["LVAR",3,1,"context"],["GVAR","complambda"],["CALLJ",3],["GVAR","list"],["CALLJ",2]]]]],["LVAR",0,1,"rs"],["GVAR","map"],["CALLJ",2],["LSET",0,1,"rs"],["POP"],["SAVE","L22",40],["LVAR",2,1,"context"],["SAVE","L21",38],["CONST","morep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FJUMP","L32",54],["SAVE","L25",52],["LVAR",2,1,"context"],["SAVE","L24",50],["SAVE","L23",48],["CONST","genlabel"],["GVAR","list"],["CALLJ",1],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L26",6],["CONST","SAVE"],["LVAR",0,0,"k"],["GVAR","gen"],["CALLJ",2],["SAVE","L27",12],["CONST","RECV"],["LVAR",1,1,"rs"],["LVAR",1,0,"after"],["GVAR","gen"],["CALLJ",3],["SAVE","L28",16],["LVAR",0,0,"k"],["GVAR","list"],["CALLJ",1],["SAVE","L29",20],["LVAR",3,1,"context"],["GVAR","comppop"],["CALLJ",1],["GVAR","seq"],["CALLJ",4]]]]],["CALLJ",1],["SAVE","L30",60],["CONST","RECV"],["LVAR",0,1,"rs"],["LVAR",0,0,"after"],["GVAR","gen"],["CALLJ",3],["SAVE","L31",64],["LVAR",2,1,"context"],["GVAR","comppop"],["CALLJ",1],["GVAR","seq"],["CALLJ",2]]]]],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","compreceive"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compmacro"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L2",8],["SAVE","L1",6],["LVAR",0,0,"e"],["GVAR","car"],["CALLJ",1],["GVAR","global"],["CALLJ",1],["FN",[["code",[["ARGS",1],["SAVE","L4",9],["LVAR",0,0,"expander"],["SAVE","L3",7],["LVAR",1,0,"e"],["GVAR","cdr"],["CALLJ",1],["GVAR","apply"],["CALLJ",2],["LVAR",1,1,"context"],["GVAR","comp"],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","compmacro"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","comp"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,0,"e"],["GVAR","symbolp"],["CALLJ",1],["FJUMP","L64",10],["LVAR",0,0,"e"],["LVAR",0,1,"context"],["GVAR","compvar"],["CALLJ",2],["SAVE","L2",14],["LVAR",0,0,"e"],["GVAR","atomp"],["CALLJ",1],["FJUMP","L63",19],["LVAR",0,0,"e"],["LVAR",0,1,"context"],["GVAR","compconst"],["CALLJ",2],["GVAR","t"],["FJUMP","L62",227],["SAVE","L3",26],["LVAR",0,0,"e"],["CONST","quote"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L61",34],["SAVE","L4",31],["LVAR",0,0,"e"],["GVAR","second"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","compconst"],["CALLJ",2],["SAVE","L5",39],["LVAR",0,0,"e"],["CONST","set"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L60",89],["SAVE","L11",64],["SAVE","L6",45],["LVAR",0,0,"e"],["GVAR","third"],["CALLJ",1],["SAVE","L10",62],["SAVE","L9",59],["SAVE","L7",52],["CONST","valuep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["SAVE","L8",57],["CONST","morep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["GVAR","list"],["CALLJ",2],["LVAR",0,1,"context"],["GVAR","append"],["CALLJ",2],["GVAR","comp"],["CALLJ",2],["SAVE","L15",79],["SAVE","L12",69],["LVAR",0,0,"e"],["GVAR","second"],["CALLJ",1],["SAVE","L14",77],["LVAR",0,1,"context"],["SAVE","L13",75],["CONST","env"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["GVAR","genset"],["CALLJ",2],["SAVE","L16",83],["LVAR",0,1,"context"],["GVAR","comppop"],["CALLJ",1],["SAVE","L17",87],["LVAR",0,1,"context"],["GVAR","compret"],["CALLJ",1],["GVAR","seq"],["CALLJ",4],["SAVE","L18",94],["LVAR",0,0,"e"],["CONST","if"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L59",110],["SAVE","L19",99],["LVAR",0,0,"e"],["GVAR","second"],["CALLJ",1],["SAVE","L20",103],["LVAR",0,0,"e"],["GVAR","third"],["CALLJ",1],["SAVE","L21",107],["LVAR",0,0,"e"],["GVAR","fourth"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","compif"],["CALLJ",4],["SAVE","L22",115],["LVAR",0,0,"e"],["CONST","begin"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L58",123],["SAVE","L23",120],["LVAR",0,0,"e"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","compbegin"],["CALLJ",2],["SAVE","L24",128],["LVAR",0,0,"e"],["CONST","lambda"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L57",168],["SAVE","L27",140],["SAVE","L26",138],["LVAR",0,1,"context"],["SAVE","L25",136],["CONST","valuep"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["GVAR","not"],["CALLJ",1],["FJUMP","L34",143],["CONST",[]],["RETURN"],["SAVE","L32",162],["CONST","FN"],["SAVE","L31",160],["SAVE","L28",150],["LVAR",0,0,"e"],["GVAR","second"],["CALLJ",1],["SAVE","L30",157],["SAVE","L29",155],["LVAR",0,0,"e"],["GVAR","cdr"],["CALLJ",1],["GVAR","cdr"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","complambda"],["CALLJ",3],["GVAR","gen"],["CALLJ",2],["SAVE","L33",166],["LVAR",0,1,"context"],["GVAR","compret"],["CALLJ",1],["GVAR","seq"],["CALLJ",2],["SAVE","L35",173],["LVAR",0,0,"e"],["CONST","receive"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L56",181],["SAVE","L36",178],["LVAR",0,0,"e"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","compreceive"],["CALLJ",2],["SAVE","L37",186],["LVAR",0,0,"e"],["CONST","evalwhen"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L55",200],["SAVE","L40",198],["CONST","begin"],["SAVE","L39",196],["SAVE","L38",194],["LVAR",0,0,"e"],["GVAR","cdr"],["CALLJ",1],["GVAR","cdr"],["CALLJ",1],["GVAR","cons"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L42",9],["CONST","compile"],["SAVE","L41",7],["LVAR",1,0,"e"],["GVAR","second"],["CALLJ",1],["GVAR","member"],["CALLJ",2],["FJUMP","L44",16],["SAVE","L43",14],["LVAR",0,0,"body"],["GVAR","eval"],["CALLJ",1],["POP"],["JUMP","L45",16],["SAVE","L47",24],["CONST","load"],["SAVE","L46",22],["LVAR",1,0,"e"],["GVAR","second"],["CALLJ",1],["GVAR","member"],["CALLJ",2],["FJUMP","L48",29],["LVAR",0,0,"body"],["LVAR",1,1,"context"],["GVAR","comp"],["CALLJ",2],["CONST",[]],["LVAR",1,1,"context"],["GVAR","compconst"],["CALLJ",2]]]]],["CALLJ",1],["GVAR","t"],["FJUMP","L54",225],["SAVE","L50",209],["SAVE","L49",207],["LVAR",0,0,"e"],["GVAR","car"],["CALLJ",1],["GVAR","macrop"],["CALLJ",1],["FJUMP","L53",214],["LVAR",0,0,"e"],["LVAR",0,1,"context"],["GVAR","compmacro"],["CALLJ",2],["SAVE","L51",218],["LVAR",0,0,"e"],["GVAR","car"],["CALLJ",1],["SAVE","L52",222],["LVAR",0,0,"e"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","compcall"],["CALLJ",3],["CONST",[]],["RETURN"],["CONST",[]],["RETURN"]]]]],["GSET","comp"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compbegin"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,0,"body"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L14",10],["CONST",[]],["LVAR",0,1,"context"],["GVAR","compconst"],["CALLJ",2],["SAVE","L2",14],["LVAR",0,0,"body"],["GVAR","singlep"],["CALLJ",1],["FJUMP","L13",22],["SAVE","L3",19],["LVAR",0,0,"body"],["GVAR","car"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","comp"],["CALLJ",2],["GVAR","t"],["FJUMP","L12",58],["SAVE","L9",48],["SAVE","L4",29],["LVAR",0,0,"body"],["GVAR","car"],["CALLJ",1],["SAVE","L8",46],["SAVE","L7",43],["SAVE","L5",36],["CONST","valuep"],["CONST",[]],["GVAR","list"],["CALLJ",2],["SAVE","L6",41],["CONST","morep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["GVAR","list"],["CALLJ",2],["LVAR",0,1,"context"],["GVAR","append"],["CALLJ",2],["GVAR","comp"],["CALLJ",2],["SAVE","L11",56],["SAVE","L10",53],["LVAR",0,0,"body"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,1,"context"],["GVAR","compbegin"],["CALLJ",2],["GVAR","seq"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["GSET","compbegin"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","complambda"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",3],["SAVE","L1",5],["LVAR",0,0,"args"],["GVAR","maketruelist"],["CALLJ",1],["FN",[["code",[["ARGS",1],["SAVE","L9",34],["SAVE","L8",31],["SAVE","L2",8],["CONST","valuep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["SAVE","L3",13],["CONST","morep"],["CONST",[]],["GVAR","list"],["CALLJ",2],["SAVE","L7",29],["CONST","env"],["SAVE","L6",27],["LVAR",0,0,"properargs"],["SAVE","L5",25],["LVAR",1,2,"context"],["SAVE","L4",23],["CONST","env"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","list"],["CALLJ",2],["GVAR","list"],["CALLJ",3],["LVAR",1,2,"context"],["GVAR","append"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L15",23],["SAVE","L14",21],["CONST","code"],["SAVE","L13",19],["SAVE","L12",17],["SAVE","L10",10],["LVAR",2,0,"args"],["GVAR","genargs"],["CALLJ",1],["SAVE","L11",15],["LVAR",2,1,"body"],["LVAR",0,0,"newcontext"],["GVAR","compbegin"],["CALLJ",2],["GVAR","seq"],["CALLJ",2],["GVAR","optimize"],["CALLJ",1],["GVAR","list"],["CALLJ",2],["GVAR","list"],["CALLJ",1],["GVAR","assemble"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","complambda"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","makelabel"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L2",9],["CONST",{s:"L"}],["SAVE","L1",7],["LVAR",0,0,"n"],["GVAR","itoa"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["GVAR","intern"],["CALLJ",1]]]]],["GSET","makelabel"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compile"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST",0],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",0],["LVAR",1,0,"labelnum"],["FN",[["code",[["ARGS",1],["SAVE","L1",6],["LVAR",2,0,"labelnum"],["CONST",1],["GVAR","+"],["CALLJ",2],["LSET",2,0,"labelnum"],["POP"],["LVAR",0,0,"n"],["GVAR","makelabel"],["CALLJ",1]]]]],["CALLJ",1]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["SAVE","L2",6],["LVAR",2,0,"e"],["GVAR","list"],["CALLJ",1],["SAVE","L7",29],["SAVE","L3",12],["CONST","genlabel"],["LVAR",0,0,"genlabel"],["GVAR","list"],["CALLJ",2],["SAVE","L4",17],["CONST","valuep"],["GVAR","t"],["GVAR","list"],["CALLJ",2],["SAVE","L5",22],["CONST","morep"],["CONST",[]],["GVAR","list"],["CALLJ",2],["SAVE","L6",27],["CONST","env"],["CONST",[]],["GVAR","list"],["CALLJ",2],["GVAR","list"],["CALLJ",4],["GVAR","complambda"],["CALLJ",3]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","compile"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","eval"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L2",8],["SAVE","L1",6],["LVAR",0,0,"e"],["GVAR","compile"],["CALLJ",1],["GVAR","boxfn"],["CALLJ",1],["CALLJ",0]]]]],["GSET","eval"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","labelp"],["GVAR","def"],["CALLJ",1],["POP"],["GVAR","symbolp"],["GSET","labelp"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","push"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST","set"],["SAVE","L5",23],["LVAR",0,0,"var"],["SAVE","L4",21],["SAVE","L3",18],["CONST","cons"],["SAVE","L2",16],["LVAR",0,1,"value"],["SAVE","L1",14],["LVAR",0,0,"var"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","push"],["POP"],["CONST","push"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","pop"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST","set"],["SAVE","L4",19],["LVAR",0,0,"var"],["SAVE","L3",17],["SAVE","L2",14],["CONST","cdr"],["SAVE","L1",12],["LVAR",0,0,"var"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","pop"],["POP"],["CONST","pop"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","incr"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST","set"],["SAVE","L5",23],["LVAR",0,0,"var"],["SAVE","L4",21],["SAVE","L3",18],["CONST","+"],["SAVE","L2",16],["LVAR",0,0,"var"],["SAVE","L1",14],["CONST",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","incr"],["POP"],["CONST","incr"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","asm1st"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST",[]],["CONST",0],["FN",[["code",[["ARGS",2],["SAVE","L11",5],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"instr"],["GVAR","labelp"],["CALLJ",1],["FJUMP","L5",17],["SAVE","L3",15],["SAVE","L2",12],["LVAR",0,0,"instr"],["LVAR",1,1,"addr"],["GVAR","list"],["CALLJ",2],["LVAR",1,0,"labels"],["GVAR","cons"],["CALLJ",2],["LSET",1,0,"labels"],["RETURN"],["SAVE","L4",22],["LVAR",1,1,"addr"],["CONST",1],["GVAR","+"],["CALLJ",2],["LSET",1,1,"addr"],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L6",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L10",8],["CONST",[]],["RETURN"],["SAVE","L8",15],["SAVE","L7",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L9",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",3,0,"code"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["LVAR",0,0,"labels"],["RETURN"]]]]],["CALLJ",2]]]]],["GSET","asm1st"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","useslabelp"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"instr"],["GVAR","car"],["CALLJ",1],["FN",[["code",[["ARGS",1],["SAVE","L2",6],["LVAR",0,0,"op"],["CONST","JUMP"],["GVAR","="],["CALLJ",2],["FJUMP","L9",9],["GVAR","t"],["RETURN"],["SAVE","L3",14],["LVAR",0,0,"op"],["CONST","FJUMP"],["GVAR","="],["CALLJ",2],["FJUMP","L8",17],["GVAR","t"],["RETURN"],["SAVE","L4",22],["LVAR",0,0,"op"],["CONST","TJUMP"],["GVAR","="],["CALLJ",2],["FJUMP","L7",25],["GVAR","t"],["RETURN"],["SAVE","L5",30],["LVAR",0,0,"op"],["CONST","SAVE"],["GVAR","="],["CALLJ",2],["FJUMP","L6",33],["GVAR","t"],["RETURN"],["CONST",[]],["RETURN"]]]]],["CALLJ",1]]]]],["GSET","useslabelp"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","asm2nd"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST",[]],["FN",[["code",[["ARGS",1],["SAVE","L18",5],["FN",[["code",[["ARGS",1],["SAVE","L2",8],["SAVE","L1",6],["LVAR",0,0,"instr"],["GVAR","labelp"],["CALLJ",1],["GVAR","not"],["CALLJ",1],["FJUMP","L12",34],["SAVE","L3",13],["LVAR",0,0,"instr"],["GVAR","useslabelp"],["CALLJ",1],["FJUMP","L9",27],["SAVE","L8",25],["SAVE","L5",23],["LVAR",2,1,"labels"],["SAVE","L4",21],["LVAR",0,0,"instr"],["GVAR","second"],["CALLJ",1],["GVAR","lookup"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L6",5],["LVAR",1,0,"instr"],["GVAR","last"],["CALLJ",1],["SAVE","L7",9],["LVAR",0,0,"pc"],["GVAR","list"],["CALLJ",1],["GVAR","setcdr"],["CALLJ",2]]]]],["CALLJ",1],["POP"],["JUMP","L10",27],["SAVE","L11",32],["LVAR",0,0,"instr"],["LVAR",1,0,"acc"],["GVAR","cons"],["CALLJ",2],["LSET",1,0,"acc"],["RETURN"],["CONST",[]],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L13",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L17",8],["CONST",[]],["RETURN"],["SAVE","L15",15],["SAVE","L14",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L16",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",3,0,"code"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["LVAR",0,0,"acc"],["GVAR","reverse"],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","asm2nd"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","assemble"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L2",9],["LVAR",0,0,"f"],["SAVE","L1",7],["CONST","code"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L3",5],["LVAR",0,0,"code"],["GVAR","asm1st"],["CALLJ",1],["FN",[["code",[["ARGS",1],["SAVE","L11",14],["SAVE","L4",7],["LVAR",1,0,"code"],["LVAR",0,0,"labels"],["GVAR","asm2nd"],["CALLJ",2],["SAVE","L5",12],["LVAR",2,0,"f"],["CONST","code"],["GVAR","slot"],["CALLJ",2],["FN",[["code",[["ARGS",2],["LVAR",0,1,"slotval"],["FJUMP","L10",14],["SAVE","L7",11],["LVAR",0,1,"slotval"],["SAVE","L6",9],["LVAR",0,0,"value"],["GVAR","list"],["CALLJ",1],["GVAR","setcdr"],["CALLJ",2],["POP"],["LVAR",3,0,"f"],["RETURN"],["SAVE","L9",23],["SAVE","L8",20],["CONST","code"],["LVAR",0,0,"value"],["GVAR","list"],["CALLJ",2],["LVAR",3,0,"f"],["GVAR","cons"],["CALLJ",2],["LSET",3,0,"f"],["RETURN"]]]]],["CALLJ",2],["POP"],["LVAR",2,0,"f"],["RETURN"]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","assemble"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","instrset"],["GVAR","def"],["CALLJ",1],["POP"],["CONST",[["LSET","i","j","name"],["GSET","name"],["ARGS","nargs"],["POP"],["LVAR","i","j","name"],["GVAR","name"],["ARGSD","nargs"],["CONST","value"],["FJUMP","label"],["SAVE","label"],["FN","f"],["TJUMP","label"],["RETURN"],["PRIM","name"],["JUMP","label"],["CALLJ","nargs"],["HALT"]]],["GSET","instrset"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","dis1st"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["SAVE","L12",5],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"instr"],["GVAR","useslabelp"],["CALLJ",1],["FJUMP","L6",23],["SAVE","L5",21],["SAVE","L4",18],["SAVE","L2",12],["LVAR",0,0,"instr"],["GVAR","third"],["CALLJ",1],["SAVE","L3",16],["LVAR",0,0,"instr"],["GVAR","second"],["CALLJ",1],["GVAR","list"],["CALLJ",2],["LVAR",1,0,"labels"],["GVAR","cons"],["CALLJ",2],["LSET",1,0,"labels"],["RETURN"],["CONST",[]],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L7",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L11",8],["CONST",[]],["RETURN"],["SAVE","L9",15],["SAVE","L8",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L10",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",3,0,"code"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["LVAR",0,0,"labels"],["GVAR","reverse"],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","dis1st"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","dis2nd"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST",{s:""}],["CONST",0],["FN",[["code",[["ARGS",2],["FN",[["code",[["ARGS",1],["SAVE","L4",9],["SAVE","L1",7],["LVAR",2,1,"labels"],["LVAR",1,1,"i"],["GVAR","lookup"],["CALLJ",2],["FN",[["code",[["ARGS",1],["LVAR",0,0,"label"],["FJUMP","L3",9],["SAVE","L2",7],["LVAR",0,0,"label"],["GVAR","write"],["CALLJ",1],["LSET",2,0,"line"],["RETURN"],["CONST",{s:""}],["LSET",2,0,"line"],["RETURN"]]]]],["CALLJ",1],["POP"],["SAVE","L6",19],["LVAR",1,0,"line"],["CONST",{s:"\t"}],["SAVE","L5",17],["LVAR",1,1,"i"],["GVAR","itoa"],["CALLJ",1],["GVAR","strcat"],["CALLJ",3],["LSET",1,0,"line"],["POP"],["SAVE","L14",25],["FN",[["code",[["ARGS",1],["SAVE","L8",10],["LVAR",2,0,"line"],["CONST",{s:"\t"}],["SAVE","L7",8],["LVAR",0,0,"x"],["GVAR","write"],["CALLJ",1],["GVAR","strcat"],["CALLJ",3],["LSET",2,0,"line"],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L9",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L13",8],["CONST",[]],["RETURN"],["SAVE","L11",15],["SAVE","L10",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L12",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",2,0,"instr"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["SAVE","L15",30],["LVAR",1,0,"line"],["GVAR","log"],["CALLJ",1],["POP"],["SAVE","L16",36],["LVAR",1,1,"i"],["CONST",1],["GVAR","+"],["CALLJ",2],["LSET",1,1,"i"],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L17",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L21",8],["CONST",[]],["RETURN"],["SAVE","L19",15],["SAVE","L18",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L20",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",3,0,"code"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",2]]]]],["GSET","dis2nd"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","disassemble"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["SAVE","L3",12],["SAVE","L1",6],["LVAR",0,0,"f"],["GVAR","unboxfn"],["CALLJ",1],["SAVE","L2",10],["CONST","code"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L17",5],["FN",[["code",[["ARGS",1],["SAVE","L4",6],["LVAR",0,0,"n"],["LVAR",1,0,"code"],["GVAR","nth"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L6",9],["SAVE","L5",7],["LVAR",0,0,"fn"],["CONST","FN"],["GVAR","startswith"],["CALLJ",2],["GVAR","not"],["CALLJ",1],["FJUMP","L11",13],["CONST",{s:"instruction op is not FN"}],["GVAR","throw"],["CALLJ",1],["SAVE","L10",27],["SAVE","L8",21],["SAVE","L7",19],["LVAR",0,0,"fn"],["GVAR","second"],["CALLJ",1],["GVAR","unboxfn"],["CALLJ",1],["SAVE","L9",25],["CONST","code"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["LSET",2,0,"code"],["RETURN"]]]]],["CALLJ",1]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L12",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L16",8],["CONST",[]],["RETURN"],["SAVE","L14",15],["SAVE","L13",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L15",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",3,1,"nesting"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["LVAR",0,0,"code"],["SAVE","L18",11],["LVAR",0,0,"code"],["GVAR","dis1st"],["CALLJ",1],["GVAR","dis2nd"],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","disassemble"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","optimize"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["LVAR",0,0,"x"],["RETURN"]]]]],["GSET","optimize"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","compilefile"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L2",10],["CONST","get"],["SAVE","L1",8],["LVAR",0,0,"name"],["CONST",{s:".lisp"}],["GVAR","strcat"],["CALLJ",2],["GVAR","http"],["CALLJ",2],["POP"],["RECV",[["response",[["code",[["ARGS",2],["CONST",{s:""}],["FN",[["code",[["ARGS",1],["SAVE","L3",6],["LVAR",1,0,"code"],["CONST",200],["GVAR","="],["CALLJ",2],["FJUMP","L26",41],["SAVE","L4",12],["LVAR",0,0,"fasl"],["CONST",{s:"[\n"}],["GVAR","strcat"],["CALLJ",2],["LSET",0,0,"fasl"],["POP"],["SAVE","L20",21],["SAVE","L5",19],["LVAR",1,1,"text"],["GVAR","readall"],["CALLJ",1],["FN",[["code",[["ARGS",1],["SAVE","L9",15],["LVAR",1,0,"fasl"],["SAVE","L8",13],["SAVE","L7",11],["SAVE","L6",9],["LVAR",0,0,"exps"],["GVAR","car"],["CALLJ",1],["GVAR","compile"],["CALLJ",1],["GVAR","tojson"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["LSET",1,0,"fasl"],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L10",6],["LVAR",2,0,"fasl"],["CONST",{s:",\n"}],["GVAR","strcat"],["CALLJ",2],["LSET",2,0,"fasl"],["POP"],["SAVE","L13",19],["LVAR",2,0,"fasl"],["SAVE","L12",17],["SAVE","L11",15],["LVAR",0,0,"exp"],["GVAR","compile"],["CALLJ",1],["GVAR","tojson"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["LSET",2,0,"fasl"],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L14",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L18",8],["CONST",[]],["RETURN"],["SAVE","L16",15],["SAVE","L15",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L17",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["SAVE","L19",8],["LVAR",2,0,"exps"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["SAVE","L21",27],["LVAR",0,0,"fasl"],["CONST",{s:"]\n"}],["GVAR","strcat"],["CALLJ",2],["LSET",0,0,"fasl"],["POP"],["SAVE","L23",39],["CONST","put"],["SAVE","L22",36],["LVAR",2,0,"name"],["CONST",{s:".fasl"}],["GVAR","strcat"],["CALLJ",2],["LVAR",0,0,"fasl"],["GVAR","http"],["CALLJ",3],["POP"],["RECV",[["response",[["code",[["ARGS",1],["SAVE","L24",6],["LVAR",0,0,"code"],["CONST",200],["GVAR","="],["CALLJ",2],["FJUMP","L25",9],["CONST",[]],["RETURN"],["CONST",{s:"compilefile: http put fail"}],["GVAR","throw"],["CALLJ",1]]]]]],[]],["CONST",[]],["RETURN"]]]]],["CALLJ",1]]]]]],[]]]]]],["GSET","compilefile"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","refresh"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"name"],["GVAR","compilefile"],["CALLJ",1],["POP"],["LVAR",0,0,"name"],["GVAR","load"],["CALLJ",1]]]]],["GSET","refresh"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","showenv"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST",0],["CONST",0],["FN",[["code",[["ARGS",2],["FN",[["code",[["ARGS",1],["SAVE","L12",5],["FN",[["code",[["ARGS",1],["SAVE","L5",21],["SAVE","L4",19],["SAVE","L1",7],["LVAR",2,0,"i"],["GVAR","write"],["CALLJ",1],["CONST",{s:"\t"}],["SAVE","L2",12],["LVAR",2,1,"j"],["GVAR","write"],["CALLJ",1],["CONST",{s:":\t"}],["SAVE","L3",17],["LVAR",0,0,"arg"],["GVAR","write"],["CALLJ",1],["GVAR","strcat"],["CALLJ",5],["GVAR","log"],["CALLJ",1],["POP"],["SAVE","L6",27],["LVAR",2,1,"j"],["CONST",1],["GVAR","+"],["CALLJ",2],["LSET",2,1,"j"],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L7",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L11",8],["CONST",[]],["RETURN"],["SAVE","L9",15],["SAVE","L8",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L10",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",2,0,"frame"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["SAVE","L13",11],["LVAR",1,0,"i"],["CONST",1],["GVAR","+"],["CALLJ",2],["LSET",1,0,"i"],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L14",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L18",8],["CONST",[]],["RETURN"],["SAVE","L16",15],["SAVE","L15",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L17",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",3,0,"env"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",2]]]]],["GSET","showenv"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","showsnapshot"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L17",5],["FN",[["code",[["ARGS",1],["SAVE","L1",6],["LVAR",0,0,"entry"],["CONST","ret"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L10",42],["SAVE","L5",22],["SAVE","L4",20],["CONST",{s:"will return to instr "}],["SAVE","L3",17],["SAVE","L2",15],["LVAR",0,0,"entry"],["GVAR","second"],["CALLJ",1],["GVAR","write"],["CALLJ",1],["CONST",{s:" of:"}],["GVAR","strcat"],["CALLJ",3],["GVAR","log"],["CALLJ",1],["POP"],["SAVE","L7",30],["SAVE","L6",28],["LVAR",0,0,"entry"],["GVAR","third"],["CALLJ",1],["GVAR","disassemble"],["CALLJ",1],["POP"],["SAVE","L8",35],["CONST",{s:"with env:"}],["GVAR","log"],["CALLJ",1],["POP"],["SAVE","L9",40],["LVAR",0,0,"entry"],["GVAR","fourth"],["CALLJ",1],["GVAR","showenv"],["CALLJ",1],["CONST",[]],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L11",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L15",8],["CONST",[]],["RETURN"],["SAVE","L13",15],["SAVE","L12",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L14",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["SAVE","L16",8],["LVAR",2,0,"s"],["GVAR","reverse"],["CALLJ",1],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["SAVE","L22",25],["SAVE","L21",23],["CONST",{s:"about to execute instr "}],["SAVE","L20",20],["SAVE","L19",18],["LVAR",0,0,"s"],["SAVE","L18",16],["CONST","pc"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["GVAR","write"],["CALLJ",1],["CONST",{s:" of:"}],["GVAR","strcat"],["CALLJ",3],["GVAR","log"],["CALLJ",1],["POP"],["SAVE","L25",37],["SAVE","L24",35],["LVAR",0,0,"s"],["SAVE","L23",33],["CONST","f"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["GVAR","disassemble"],["CALLJ",1],["POP"],["SAVE","L26",42],["CONST",{s:"with env:"}],["GVAR","log"],["CALLJ",1],["POP"],["SAVE","L28",51],["LVAR",0,0,"s"],["SAVE","L27",49],["CONST","env"],["GVAR","list"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2],["GVAR","showenv"],["CALLJ",1]]]]],["GSET","showsnapshot"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","backtrace"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"name"],["GVAR","snapshot"],["CALLJ",1],["FN",[["code",[["ARGS",1],["LVAR",0,0,"s"],["GVAR","showsnapshot"],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","backtrace"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","break"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L4",16],["SAVE","L3",14],["CONST",{s:"proc "}],["SAVE","L2",10],["SAVE","L1",8],["GVAR","self"],["CALLJ",0],["GVAR","write"],["CALLJ",1],["CONST",{s:" breakpoint: "}],["LVAR",0,0,"s"],["GVAR","strcat"],["CALLJ",4],["GVAR","log"],["CALLJ",1],["POP"],["RECV",[["continue",[["code",[["ARGS",1],["LVAR",0,0,"x"],["RETURN"]]]]]],[]]]]]],["GSET","break"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","continue"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["LVAR",0,0,"pid"],["SAVE","L1",7],["CONST","continue"],["LVAR",0,1,"x"],["GVAR","list"],["CALLJ",2],["GVAR","sendmsg"],["CALLJ",2]]]]],["GSET","continue"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","examples"],["GVAR","def"],["CALLJ",1],["POP"],["SAVE","L6",31],["CONST",{s:"  (log \"hello, world!\")"}],["SAVE","L5",29],["CONST",{s:"  `(foo 3 ,(+ 5 6) \"bar\")"}],["SAVE","L4",27],["CONST",{s:"  (disassemble length)"}],["SAVE","L3",25],["CONST",{s:"  (backtrace (self))"}],["SAVE","L2",23],["CONST",{s:"  (compile '(+ 1 2))"}],["SAVE","L1",21],["CONST",{s:"  (globals)"}],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GSET","examples"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","showexamples"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",0],["SAVE","L1",5],["CONST",{s:"Try these:"}],["GVAR","log"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["LVAR",0,0,"e"],["GVAR","log"],["CALLJ",1]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L2",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L6",8],["CONST",[]],["RETURN"],["SAVE","L4",15],["SAVE","L3",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L5",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["GVAR","examples"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","showexamples"],["RETURN"]]]],
[["code",[["ARGS",0],["CONST","put"],["CONST",["textin","value"]],["SAVE","L0",9],["CONST",{s:";; Press the evaluate button to..\n"}],["CONST",{s:"\n"}],["CONST",{s:"(showexamples)\n"}],["GVAR","strcat"],["CALLJ",3],["GVAR","doc"],["CALLJ",3]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","replslave"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["FN",[["code",[["ARGS",0],["SAVE","L2",9],["GVAR","eval"],["SAVE","L1",7],["LVAR",1,1,"text"],["GVAR","readall"],["CALLJ",1],["GVAR","map"],["CALLJ",2],["FN",[["code",[["ARGS",1],["LVAR",2,0,"pid"],["SAVE","L3",7],["CONST","result"],["LVAR",0,0,"output"],["GVAR","list"],["CALLJ",2],["GVAR","sendmsg"],["CALLJ",2]]]]],["CALLJ",1]]]]],["RETURN"]]]]],["GSET","replslave"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","repl"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",0],["SAVE","L19",3],["RECV",[["exit",[["code",[["ARGS",2],["SAVE","L1",6],["LVAR",0,1,"reason"],["CONST","normal"],["GVAR","="],["CALLJ",2],["FJUMP","L5",9],["CONST",[]],["RETURN"],["SAVE","L2",13],["LVAR",0,0,"snap"],["GVAR","showsnapshot"],["CALLJ",1],["POP"],["SAVE","L4",22],["CONST",{s:"process died: "}],["SAVE","L3",20],["LVAR",0,1,"reason"],["GVAR","write"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["GVAR","log"],["CALLJ",1]]]]],["result",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L6",5],["LVAR",0,0,"e"],["GVAR","write"],["CALLJ",1],["GVAR","log"],["CALLJ",1]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L7",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L11",8],["CONST",[]],["RETURN"],["SAVE","L9",15],["SAVE","L8",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L10",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",2,0,"exps"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["click",[["code",[["ARGS",1],["SAVE","L12",6],["LVAR",0,0,"id"],["CONST","evaluate"],["GVAR","="],["CALLJ",2],["FJUMP","L18",14],["SAVE","L13",12],["CONST","get"],["CONST",["textin","value"]],["GVAR","doc"],["CALLJ",2],["FN",[["code",[["ARGS",1],["SAVE","L15",8],["SAVE","L14",5],["GVAR","self"],["CALLJ",0],["LVAR",0,0,"text"],["GVAR","replslave"],["CALLJ",2],["GVAR","spawnlink"],["CALLJ",1]]]]],["CALLJ",1],["SAVE","L16",19],["LVAR",0,0,"id"],["CONST","clear"],["GVAR","="],["CALLJ",2],["FJUMP","L17",25],["CONST","put"],["CONST",["textout","value"]],["CONST",{s:""}],["GVAR","doc"],["CALLJ",3],["CONST",[]],["RETURN"]]]]]],[]],["POP"],["GVAR","repl"],["CALLJ",0]]]]],["GSET","repl"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","startrepl"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",0],["SAVE","L4",5],["FN",[["code",[["ARGS",0],["SAVE","L1",7],["CONST","post"],["CONST",["evaluate","listeners"]],["CONST","click"],["GVAR","doc"],["CALLJ",3],["POP"],["SAVE","L2",14],["CONST","post"],["CONST",["clear","listeners"]],["CONST","click"],["GVAR","doc"],["CALLJ",3],["POP"],["SAVE","L3",18],["GVAR","trapexits"],["CALLJ",0],["POP"],["GVAR","repl"],["CALLJ",0]]]]],["GVAR","spawn"],["CALLJ",1],["GSET","replpid"],["RETURN"]]]]],["GSET","startrepl"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","replpid"],["GVAR","def"],["CALLJ",1],["POP"],["CONST",[]],["GSET","replpid"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","subservience"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",0],["SAVE","L2",7],["SAVE","L1",5],["GVAR","self"],["CALLJ",0],["GVAR","giveup"],["CALLJ",1],["POP"],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",0],["SAVE","L17",3],["RECV",[["eval",[["code",[["ARGS",2],["FN",[["code",[["ARGS",0],["SAVE","L3",4],["GVAR","trapexits"],["CALLJ",0],["POP"],["SAVE","L6",15],["SAVE","L5",13],["SAVE","L4",10],["GVAR","self"],["CALLJ",0],["LVAR",1,0,"text"],["GVAR","replslave"],["CALLJ",2],["GVAR","spawnlink"],["CALLJ",1],["POP"],["RECV",[["exit",[["code",[["ARGS",2],["SAVE","L8",9],["CONST",{s:"process died: "}],["SAVE","L7",7],["LVAR",0,1,"reason"],["GVAR","write"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["GVAR","log"],["CALLJ",1]]]]],["result",[["code",[["ARGS",1],["CONST",{s:""}],["FN",[["code",[["ARGS",1],["SAVE","L16",5],["FN",[["code",[["ARGS",1],["SAVE","L10",10],["LVAR",1,0,"output"],["CONST",{s:"\n"}],["SAVE","L9",8],["LVAR",0,0,"e"],["GVAR","write"],["CALLJ",1],["GVAR","strcat"],["CALLJ",3],["LSET",1,0,"output"],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L11",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L15",8],["CONST",[]],["RETURN"],["SAVE","L13",15],["SAVE","L12",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L14",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",3,0,"exps"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["LVAR",0,0,"output"],["LVAR",3,1,"callback"],["CALLJ",1]]]]],["CALLJ",1]]]]]],[]]]]]],["GVAR","spawn"],["CALLJ",1]]]]]],[]],["POP"],["LVAR",1,0,"loop"],["CALLJ",0]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",0,0,"loop"],["CALLJ",0]]]]],["CALLJ",1]]]]],["GSET","subservience"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","startsubservience"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",0],["GVAR","subservience"],["GVAR","spawn"],["CALLJ",1]]]]],["GSET","startsubservience"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","strextend"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["CONST","set"],["SAVE","L4",19],["LVAR",0,0,"var"],["SAVE","L3",17],["SAVE","L2",14],["CONST","strcat"],["SAVE","L1",12],["LVAR",0,0,"var"],["LVAR",0,1,"s"],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","strextend"],["POP"],["CONST","strextend"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","readall"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST",[]],["CONST",[]],["CONST",[]],["CONST",[]],["CONST",[]],["CONST",[]],["CONST",[]],["CONST",[]],["CONST",[]],["CONST",[]],["CONST",[]],["FN",[["code",[["ARGS",11],["CONST",0],["LSET",0,0,"i"],["POP"],["FN",[["code",[["ARGS",0],["LVAR",2,0,"s"],["LVAR",1,0,"i"],["GVAR","sref"],["CALLJ",2]]]]],["LSET",0,1,"peek"],["POP"],["FN",[["code",[["ARGS",0],["SAVE","L1",6],["LVAR",1,0,"i"],["CONST",1],["GVAR","+"],["CALLJ",2],["LSET",1,0,"i"],["RETURN"]]]]],["LSET",0,2,"advance"],["POP"],["FN",[["code",[["ARGS",0],["CONST",{s:" \t\n;"}],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",0],["SAVE","L2",4],["LVAR",4,4,"donep"],["CALLJ",0],["FJUMP","L21",7],["CONST",[]],["RETURN"],["SAVE","L4",14],["SAVE","L3",11],["LVAR",4,1,"peek"],["CALLJ",0],["LVAR",2,0,"ws"],["GVAR","substringp"],["CALLJ",2],["FJUMP","L20",40],["SAVE","L6",22],["SAVE","L5",19],["LVAR",4,1,"peek"],["CALLJ",0],["CONST",{s:";"}],["GVAR","="],["CALLJ",2],["FJUMP","L14",29],["SAVE","L13",27],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",0],["SAVE","L7",4],["LVAR",6,4,"donep"],["CALLJ",0],["FJUMP","L12",7],["CONST",[]],["RETURN"],["SAVE","L9",14],["SAVE","L8",11],["LVAR",6,1,"peek"],["CALLJ",0],["CONST",{s:"\n"}],["GVAR","!="],["CALLJ",2],["FJUMP","L11",21],["SAVE","L10",18],["LVAR",6,2,"advance"],["CALLJ",0],["POP"],["LVAR",1,0,"loop"],["CALLJ",0],["CONST",[]],["RETURN"]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",0,0,"loop"],["CALLJ",0]]]]],["CALLJ",1],["POP"],["JUMP","L15",29],["SAVE","L16",32],["LVAR",4,4,"donep"],["CALLJ",0],["FJUMP","L18",34],["JUMP","L19",38],["SAVE","L17",37],["LVAR",4,2,"advance"],["CALLJ",0],["POP"],["LVAR",1,0,"loop"],["CALLJ",0],["CONST",[]],["RETURN"]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",0,0,"loop"],["CALLJ",0]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["LSET",0,3,"skipws"],["POP"],["FN",[["code",[["ARGS",0],["LVAR",1,0,"i"],["SAVE","L22",6],["LVAR",2,0,"s"],["GVAR","slength"],["CALLJ",1],["GVAR","="],["CALLJ",2]]]]],["LSET",0,4,"donep"],["POP"],["FN",[["code",[["ARGS",0],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L23",4],["LVAR",3,3,"skipws"],["CALLJ",0],["POP"],["SAVE","L24",8],["LVAR",3,4,"donep"],["CALLJ",0],["FJUMP","L50",12],["CONST",{s:"unmatched \"(\""}],["GVAR","throw"],["CALLJ",1],["SAVE","L26",19],["SAVE","L25",16],["LVAR",3,1,"peek"],["CALLJ",0],["CONST",{s:")"}],["GVAR","="],["CALLJ",2],["FJUMP","L49",27],["SAVE","L27",23],["LVAR",3,2,"advance"],["CALLJ",0],["POP"],["LVAR",0,0,"acc"],["GVAR","reverse"],["CALLJ",1],["SAVE","L29",34],["SAVE","L28",31],["LVAR",3,1,"peek"],["CALLJ",0],["CONST",{s:"."}],["GVAR","="],["CALLJ",2],["FJUMP","L48",87],["SAVE","L30",38],["LVAR",3,2,"advance"],["CALLJ",0],["POP"],["SAVE","L31",43],["LVAR",0,0,"acc"],["GVAR","reverse"],["CALLJ",1],["LSET",0,0,"acc"],["POP"],["SAVE","L34",55],["SAVE","L32",50],["LVAR",0,0,"acc"],["GVAR","last"],["CALLJ",1],["SAVE","L33",53],["LVAR",3,10,"read"],["CALLJ",0],["GVAR","setcdr"],["CALLJ",2],["POP"],["SAVE","L35",59],["LVAR",3,3,"skipws"],["CALLJ",0],["POP"],["SAVE","L36",63],["LVAR",3,4,"donep"],["CALLJ",0],["FJUMP","L41",66],["GVAR","t"],["JUMP","L42",77],["SAVE","L38",73],["SAVE","L37",70],["LVAR",3,1,"peek"],["CALLJ",0],["CONST",{s:")"}],["GVAR","!="],["CALLJ",2],["FJUMP","L39",76],["GVAR","t"],["JUMP","L40",77],["CONST",[]],["FJUMP","L44",81],["CONST",{s:"ill-formed dotted list"}],["GVAR","throw"],["CALLJ",1],["SAVE","L43",84],["LVAR",3,2,"advance"],["CALLJ",0],["POP"],["LVAR",0,0,"acc"],["RETURN"],["GVAR","t"],["FJUMP","L47",98],["SAVE","L46",96],["SAVE","L45",93],["LVAR",3,10,"read"],["CALLJ",0],["LVAR",0,0,"acc"],["GVAR","cons"],["CALLJ",2],["LVAR",1,0,"loop"],["CALLJ",1],["CONST",[]],["RETURN"]]]]],["LSET",0,0,"loop"],["POP"],["CONST",[]],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["LSET",0,5,"readlist"],["POP"],["FN",[["code",[["ARGS",0],["CONST",{s:"()'\" \t\n"}],["LVAR",1,0,"i"],["FN",[["code",[["ARGS",2],["SAVE","L60",5],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",0],["SAVE","L51",4],["LVAR",4,4,"donep"],["CALLJ",0],["FJUMP","L56",7],["GVAR","t"],["JUMP","L57",18],["SAVE","L53",14],["SAVE","L52",11],["LVAR",4,1,"peek"],["CALLJ",0],["LVAR",2,0,"terminators"],["GVAR","substringp"],["CALLJ",2],["FJUMP","L54",17],["GVAR","t"],["JUMP","L55",18],["CONST",[]],["FJUMP","L59",21],["CONST",[]],["RETURN"],["SAVE","L58",24],["LVAR",4,2,"advance"],["CALLJ",0],["POP"],["LVAR",1,0,"loop"],["CALLJ",0]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",0,0,"loop"],["CALLJ",0]]]]],["CALLJ",1],["POP"],["SAVE","L61",12],["LVAR",3,0,"s"],["LVAR",0,1,"mark"],["LVAR",2,0,"i"],["GVAR","substring"],["CALLJ",3],["FN",[["code",[["ARGS",1],["SAVE","L62",6],["LVAR",0,0,"substr"],["CONST",{s:"nil"}],["GVAR","="],["CALLJ",2],["FJUMP","L66",9],["CONST",[]],["RETURN"],["SAVE","L63",13],["LVAR",0,0,"substr"],["GVAR","atoi"],["CALLJ",1],["FJUMP","L65",17],["LVAR",0,0,"substr"],["GVAR","atoi"],["CALLJ",1],["GVAR","t"],["FJUMP","L64",22],["LVAR",0,0,"substr"],["GVAR","intern"],["CALLJ",1],["CONST",[]],["RETURN"]]]]],["CALLJ",1]]]]],["CALLJ",2]]]]],["LSET",0,6,"readatom"],["POP"],["FN",[["code",[["ARGS",0],["CONST","quasiquote"],["SAVE","L67",5],["LVAR",1,10,"read"],["CALLJ",0],["GVAR","list"],["CALLJ",2]]]]],["LSET",0,7,"readquasi"],["POP"],["FN",[["code",[["ARGS",0],["SAVE","L68",4],["LVAR",1,4,"donep"],["CALLJ",0],["FJUMP","L76",8],["CONST",{s:"syntax error"}],["GVAR","throw"],["CALLJ",1],["SAVE","L70",15],["SAVE","L69",12],["LVAR",1,1,"peek"],["CALLJ",0],["CONST",{s:"@"}],["GVAR","="],["CALLJ",2],["FJUMP","L75",26],["SAVE","L71",19],["LVAR",1,2,"advance"],["CALLJ",0],["POP"],["CONST","unquotesplicing"],["SAVE","L72",24],["LVAR",1,10,"read"],["CALLJ",0],["GVAR","list"],["CALLJ",2],["GVAR","t"],["FJUMP","L74",34],["CONST","unquote"],["SAVE","L73",32],["LVAR",1,10,"read"],["CALLJ",0],["GVAR","list"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["LSET",0,8,"readcomma"],["POP"],["FN",[["code",[["ARGS",0],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",0],["SAVE","L77",4],["LVAR",4,1,"peek"],["CALLJ",0],["FN",[["code",[["ARGS",1],["SAVE","L78",4],["LVAR",5,2,"advance"],["CALLJ",0],["POP"],["SAVE","L79",10],["LVAR",2,0,"content"],["LVAR",0,0,"c"],["GVAR","strcat"],["CALLJ",2],["LVAR",3,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["FN",[["code",[["ARGS",1],["SAVE","L80",4],["LVAR",4,2,"advance"],["CALLJ",0],["POP"],["SAVE","L81",10],["LVAR",1,0,"content"],["LVAR",0,0,"c"],["GVAR","strcat"],["CALLJ",2],["LVAR",2,0,"loop"],["CALLJ",1]]]]],["FN",[["code",[["ARGS",2],["SAVE","L82",4],["LVAR",4,4,"donep"],["CALLJ",0],["FJUMP","L109",8],["CONST",{s:"unterminated string"}],["GVAR","throw"],["CALLJ",1],["SAVE","L84",15],["SAVE","L83",12],["LVAR",4,1,"peek"],["CALLJ",0],["CONST",{s:"\""}],["GVAR","="],["CALLJ",2],["FJUMP","L108",22],["SAVE","L85",19],["LVAR",4,2,"advance"],["CALLJ",0],["POP"],["LVAR",1,0,"content"],["RETURN"],["SAVE","L87",29],["SAVE","L86",26],["LVAR",4,1,"peek"],["CALLJ",0],["CONST",{s:"\\"}],["GVAR","="],["CALLJ",2],["FJUMP","L107",98],["SAVE","L88",33],["LVAR",4,2,"advance"],["CALLJ",0],["POP"],["SAVE","L89",37],["LVAR",4,4,"donep"],["CALLJ",0],["FJUMP","L105",41],["CONST",{s:"unterminated string"}],["GVAR","throw"],["CALLJ",1],["SAVE","L91",48],["SAVE","L90",45],["LVAR",4,1,"peek"],["CALLJ",0],["CONST",{s:"t"}],["GVAR","="],["CALLJ",2],["FJUMP","L104",52],["CONST",{s:"\t"}],["LVAR",0,1,"escjmp"],["CALLJ",1],["SAVE","L93",59],["SAVE","L92",56],["LVAR",4,1,"peek"],["CALLJ",0],["CONST",{s:"n"}],["GVAR","="],["CALLJ",2],["FJUMP","L103",63],["CONST",{s:"\n"}],["LVAR",0,1,"escjmp"],["CALLJ",1],["SAVE","L95",70],["SAVE","L94",67],["LVAR",4,1,"peek"],["CALLJ",0],["CONST",{s:"\\"}],["GVAR","="],["CALLJ",2],["FJUMP","L102",74],["CONST",{s:"\\"}],["LVAR",0,1,"escjmp"],["CALLJ",1],["SAVE","L97",81],["SAVE","L96",78],["LVAR",4,1,"peek"],["CALLJ",0],["CONST",{s:"\""}],["GVAR","="],["CALLJ",2],["FJUMP","L101",85],["CONST",{s:"\""}],["LVAR",0,1,"escjmp"],["CALLJ",1],["GVAR","t"],["FJUMP","L100",96],["SAVE","L99",94],["CONST",{s:"unknown escape: \\"}],["SAVE","L98",92],["LVAR",4,1,"peek"],["CALLJ",0],["GVAR","strcat"],["CALLJ",2],["GVAR","throw"],["CALLJ",1],["CONST",[]],["RETURN"],["GVAR","t"],["FJUMP","L106",102],["LVAR",0,0,"pushjmp"],["CALLJ",0],["CONST",[]],["RETURN"]]]]],["CALLJ",2]]]]],["LSET",0,0,"loop"],["POP"],["CONST",{s:""}],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["LSET",0,9,"readstring"],["POP"],["FN",[["code",[["ARGS",0],["SAVE","L110",4],["LVAR",1,3,"skipws"],["CALLJ",0],["POP"],["SAVE","L111",8],["LVAR",1,4,"donep"],["CALLJ",0],["FJUMP","L113",15],["SAVE","L112",13],["CONST",{s:"read: syntax error"}],["GVAR","throw"],["CALLJ",1],["POP"],["JUMP","L114",15],["SAVE","L116",22],["SAVE","L115",19],["LVAR",1,1,"peek"],["CALLJ",0],["CONST",{s:"`"}],["GVAR","="],["CALLJ",2],["FJUMP","L139",29],["SAVE","L117",26],["LVAR",1,2,"advance"],["CALLJ",0],["POP"],["LVAR",1,7,"readquasi"],["CALLJ",0],["SAVE","L119",36],["SAVE","L118",33],["LVAR",1,1,"peek"],["CALLJ",0],["CONST",{s:","}],["GVAR","="],["CALLJ",2],["FJUMP","L138",43],["SAVE","L120",40],["LVAR",1,2,"advance"],["CALLJ",0],["POP"],["LVAR",1,8,"readcomma"],["CALLJ",0],["SAVE","L122",50],["SAVE","L121",47],["LVAR",1,1,"peek"],["CALLJ",0],["CONST",{s:"("}],["GVAR","="],["CALLJ",2],["FJUMP","L137",57],["SAVE","L123",54],["LVAR",1,2,"advance"],["CALLJ",0],["POP"],["LVAR",1,5,"readlist"],["CALLJ",0],["SAVE","L125",64],["SAVE","L124",61],["LVAR",1,1,"peek"],["CALLJ",0],["CONST",{s:")"}],["GVAR","="],["CALLJ",2],["FJUMP","L136",68],["CONST",{s:"unbalanced \")\""}],["GVAR","throw"],["CALLJ",1],["SAVE","L127",75],["SAVE","L126",72],["LVAR",1,1,"peek"],["CALLJ",0],["CONST",{s:"'"}],["GVAR","="],["CALLJ",2],["FJUMP","L135",86],["SAVE","L128",79],["LVAR",1,2,"advance"],["CALLJ",0],["POP"],["CONST","quote"],["SAVE","L129",84],["LVAR",1,10,"read"],["CALLJ",0],["GVAR","list"],["CALLJ",2],["SAVE","L131",93],["SAVE","L130",90],["LVAR",1,1,"peek"],["CALLJ",0],["CONST",{s:"\""}],["GVAR","="],["CALLJ",2],["FJUMP","L134",100],["SAVE","L132",97],["LVAR",1,2,"advance"],["CALLJ",0],["POP"],["LVAR",1,9,"readstring"],["CALLJ",0],["GVAR","t"],["FJUMP","L133",104],["LVAR",1,6,"readatom"],["CALLJ",0],["CONST",[]],["RETURN"]]]]],["LSET",0,10,"read"],["POP"],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L140",4],["LVAR",2,3,"skipws"],["CALLJ",0],["POP"],["SAVE","L141",8],["LVAR",2,4,"donep"],["CALLJ",0],["FJUMP","L144",12],["LVAR",0,0,"acc"],["GVAR","reverse"],["CALLJ",1],["SAVE","L143",19],["SAVE","L142",16],["LVAR",2,10,"read"],["CALLJ",0],["LVAR",0,0,"acc"],["GVAR","cons"],["CALLJ",2],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["CONST",[]],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",11]]]]],["GSET","readall"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","escape"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"s"],["GVAR","slength"],["CALLJ",1],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",2],["FN",[["code",[["ARGS",1],["SAVE","L2",7],["LVAR",1,0,"se"],["CONST",{s:"\\"}],["LVAR",0,0,"c"],["GVAR","strcat"],["CALLJ",3],["SAVE","L3",12],["LVAR",1,1,"i"],["CONST",1],["GVAR","+"],["CALLJ",2],["LVAR",2,0,"loop"],["CALLJ",2]]]]],["FN",[["code",[["ARGS",1],["SAVE","L4",6],["LVAR",1,1,"i"],["LVAR",3,0,"n"],["GVAR","="],["CALLJ",2],["FJUMP","L21",9],["LVAR",1,0,"se"],["RETURN"],["SAVE","L6",18],["SAVE","L5",15],["LVAR",4,0,"s"],["LVAR",1,1,"i"],["GVAR","sref"],["CALLJ",2],["CONST",{s:"\\"}],["GVAR","="],["CALLJ",2],["FJUMP","L20",22],["CONST",{s:"\\"}],["LVAR",0,0,"escjmp"],["CALLJ",1],["SAVE","L8",31],["SAVE","L7",28],["LVAR",4,0,"s"],["LVAR",1,1,"i"],["GVAR","sref"],["CALLJ",2],["CONST",{s:"\""}],["GVAR","="],["CALLJ",2],["FJUMP","L19",35],["CONST",{s:"\""}],["LVAR",0,0,"escjmp"],["CALLJ",1],["SAVE","L10",44],["SAVE","L9",41],["LVAR",4,0,"s"],["LVAR",1,1,"i"],["GVAR","sref"],["CALLJ",2],["CONST",{s:"\n"}],["GVAR","="],["CALLJ",2],["FJUMP","L18",48],["CONST",{s:"n"}],["LVAR",0,0,"escjmp"],["CALLJ",1],["SAVE","L12",57],["SAVE","L11",54],["LVAR",4,0,"s"],["LVAR",1,1,"i"],["GVAR","sref"],["CALLJ",2],["CONST",{s:"\t"}],["GVAR","="],["CALLJ",2],["FJUMP","L17",61],["CONST",{s:"t"}],["LVAR",0,0,"escjmp"],["CALLJ",1],["GVAR","t"],["FJUMP","L16",79],["SAVE","L14",72],["LVAR",1,0,"se"],["SAVE","L13",70],["LVAR",4,0,"s"],["LVAR",1,1,"i"],["GVAR","sref"],["CALLJ",2],["GVAR","strcat"],["CALLJ",2],["SAVE","L15",77],["LVAR",1,1,"i"],["CONST",1],["GVAR","+"],["CALLJ",2],["LVAR",2,0,"loop"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["CONST",{s:""}],["CONST",0],["LVAR",0,0,"loop"],["CALLJ",2]]]]],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","escape"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","writecons"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L13",5],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"tail"],["GVAR","car"],["CALLJ",1],["SAVE","L2",9],["LVAR",0,1,"tail"],["GVAR","cdr"],["CALLJ",1],["FN",[["code",[["ARGS",2],["SAVE","L3",5],["LVAR",0,1,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L12",13],["LVAR",1,0,"s"],["SAVE","L4",11],["LVAR",0,0,"a"],["GVAR","write"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["SAVE","L5",17],["LVAR",0,1,"tail"],["GVAR","consp"],["CALLJ",1],["FJUMP","L11",30],["SAVE","L7",27],["LVAR",1,0,"s"],["SAVE","L6",24],["LVAR",0,0,"a"],["GVAR","write"],["CALLJ",1],["CONST",{s:" "}],["GVAR","strcat"],["CALLJ",3],["LVAR",0,1,"tail"],["LVAR",2,0,"loop"],["CALLJ",2],["GVAR","t"],["FJUMP","L10",44],["LVAR",1,0,"s"],["SAVE","L8",37],["LVAR",0,0,"a"],["GVAR","write"],["CALLJ",1],["CONST",{s:" . "}],["SAVE","L9",42],["LVAR",0,1,"tail"],["GVAR","write"],["CALLJ",1],["GVAR","strcat"],["CALLJ",4],["CONST",[]],["RETURN"]]]]],["CALLJ",2]]]]],["LSET",0,0,"loop"],["POP"],["CONST",{s:"("}],["LVAR",1,0,"x"],["LVAR",0,0,"loop"],["CALLJ",2]]]]],["CALLJ",1],["CONST",{s:")"}],["GVAR","strcat"],["CALLJ",2]]]]],["GSET","writecons"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","write"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L22",8],["CONST",{s:"nil"}],["RETURN"],["SAVE","L2",12],["LVAR",0,0,"x"],["GVAR","symbolp"],["CALLJ",1],["FJUMP","L21",16],["LVAR",0,0,"x"],["GVAR","symbolname"],["CALLJ",1],["SAVE","L3",20],["LVAR",0,0,"x"],["GVAR","numberp"],["CALLJ",1],["FJUMP","L20",24],["LVAR",0,0,"x"],["GVAR","itoa"],["CALLJ",1],["SAVE","L4",28],["LVAR",0,0,"x"],["GVAR","stringp"],["CALLJ",1],["FJUMP","L19",37],["CONST",{s:"\""}],["SAVE","L5",34],["LVAR",0,0,"x"],["GVAR","escape"],["CALLJ",1],["CONST",{s:"\""}],["GVAR","strcat"],["CALLJ",3],["SAVE","L6",41],["LVAR",0,0,"x"],["GVAR","consp"],["CALLJ",1],["FJUMP","L18",45],["LVAR",0,0,"x"],["GVAR","writecons"],["CALLJ",1],["SAVE","L7",49],["LVAR",0,0,"x"],["GVAR","templatep"],["CALLJ",1],["FJUMP","L17",52],["CONST",{s:"<template>"}],["RETURN"],["SAVE","L8",56],["LVAR",0,0,"x"],["GVAR","functionp"],["CALLJ",1],["FJUMP","L16",59],["CONST",{s:"<function>"}],["RETURN"],["SAVE","L9",63],["LVAR",0,0,"x"],["GVAR","processp"],["CALLJ",1],["FJUMP","L15",66],["CONST",{s:"<process>"}],["RETURN"],["SAVE","L10",70],["LVAR",0,0,"x"],["GVAR","cellp"],["CALLJ",1],["FJUMP","L14",73],["CONST",{s:"<cell>"}],["RETURN"],["SAVE","L11",77],["LVAR",0,0,"x"],["GVAR","arrayp"],["CALLJ",1],["FJUMP","L13",80],["CONST",{s:"<array>"}],["RETURN"],["GVAR","t"],["FJUMP","L12",85],["CONST",{s:"write: unknown type"}],["GVAR","throw"],["CALLJ",1],["CONST",[]],["RETURN"]]]]],["GSET","write"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","arrayfromlist"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L15",8],["CONST",{s:"[]"}],["RETURN"],["CONST",{s:"["}],["FN",[["code",[["ARGS",1],["SAVE","L4",12],["LVAR",0,0,"s"],["SAVE","L3",10],["SAVE","L2",8],["LVAR",1,0,"x"],["GVAR","car"],["CALLJ",1],["GVAR","tojson"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["LSET",0,0,"s"],["POP"],["SAVE","L13",18],["FN",[["code",[["ARGS",1],["SAVE","L6",10],["LVAR",1,0,"s"],["CONST",{s:","}],["SAVE","L5",8],["LVAR",0,0,"elt"],["GVAR","tojson"],["CALLJ",1],["GVAR","strcat"],["CALLJ",3],["LSET",1,0,"s"],["RETURN"]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L7",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L11",8],["CONST",[]],["RETURN"],["SAVE","L9",15],["SAVE","L8",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L10",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["SAVE","L12",8],["LVAR",3,0,"x"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["SAVE","L14",24],["LVAR",0,0,"s"],["CONST",{s:"]"}],["GVAR","strcat"],["CALLJ",2],["LSET",0,0,"s"],["POP"],["LVAR",0,0,"s"],["RETURN"]]]]],["CALLJ",1]]]]],["GSET","arrayfromlist"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","tojson"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","functionp"],["CALLJ",1],["FJUMP","L20",12],["SAVE","L2",10],["LVAR",0,0,"x"],["GVAR","unboxfn"],["CALLJ",1],["GVAR","tojson"],["CALLJ",1],["SAVE","L3",16],["LVAR",0,0,"x"],["GVAR","numberp"],["CALLJ",1],["FJUMP","L19",20],["LVAR",0,0,"x"],["GVAR","write"],["CALLJ",1],["SAVE","L4",24],["LVAR",0,0,"x"],["GVAR","symbolp"],["CALLJ",1],["FJUMP","L18",33],["CONST",{s:"\""}],["SAVE","L5",30],["LVAR",0,0,"x"],["GVAR","write"],["CALLJ",1],["CONST",{s:"\""}],["GVAR","strcat"],["CALLJ",3],["SAVE","L6",37],["LVAR",0,0,"x"],["GVAR","stringp"],["CALLJ",1],["FJUMP","L17",46],["CONST",{s:"{s:\""}],["SAVE","L7",43],["LVAR",0,0,"x"],["GVAR","escape"],["CALLJ",1],["CONST",{s:"\"}"}],["GVAR","strcat"],["CALLJ",3],["SAVE","L8",50],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L16",53],["CONST",{s:"[]"}],["RETURN"],["SAVE","L9",57],["LVAR",0,0,"x"],["GVAR","consp"],["CALLJ",1],["FJUMP","L15",77],["SAVE","L10",62],["LVAR",0,0,"x"],["GVAR","dottedp"],["CALLJ",1],["FJUMP","L13",74],["CONST",{s:"{d:"}],["SAVE","L12",71],["SAVE","L11",69],["LVAR",0,0,"x"],["GVAR","maketruelist"],["CALLJ",1],["GVAR","arrayfromlist"],["CALLJ",1],["CONST",{s:"}"}],["GVAR","strcat"],["CALLJ",3],["LVAR",0,0,"x"],["GVAR","arrayfromlist"],["CALLJ",1],["GVAR","t"],["FJUMP","L14",82],["CONST",{s:"tojson: unknown type"}],["GVAR","throw"],["CALLJ",1],["CONST",[]],["RETURN"]]]]],["GSET","tojson"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","define"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST","begin"],["SAVE","L8",35],["SAVE","L3",16],["CONST","def"],["SAVE","L2",14],["SAVE","L1",11],["CONST","quote"],["LVAR",0,0,"var"],["GVAR","list"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L7",33],["SAVE","L6",30],["CONST","set"],["SAVE","L5",28],["LVAR",0,0,"var"],["SAVE","L4",26],["LVAR",0,1,"val"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","define"],["POP"],["CONST","define"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","defmac"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST","begin"],["SAVE","L8",35],["SAVE","L3",16],["CONST","define"],["SAVE","L2",14],["LVAR",0,0,"var"],["SAVE","L1",12],["LVAR",0,1,"val"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L7",33],["SAVE","L6",30],["CONST","mac"],["SAVE","L5",28],["SAVE","L4",25],["CONST","quote"],["LVAR",0,0,"var"],["GVAR","list"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","defmac"],["POP"],["CONST","defmac"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","t"],["GVAR","def"],["CALLJ",1],["POP"],["CONST","t"],["GSET","t"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","nilp"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["LVAR",0,0,"x"],["CONST",[]],["GVAR","="],["CALLJ",2]]]]],["GSET","nilp"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","caar"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["GVAR","car"],["CALLJ",1]]]]],["GSET","caar"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","cadr"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","car"],["CALLJ",1]]]]],["GSET","cadr"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","cdar"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["GVAR","cdr"],["CALLJ",1]]]]],["GSET","cdar"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","cddr"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","cdr"],["CALLJ",1]]]]],["GSET","cddr"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","cond"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",0],["SAVE","L1",5],["LVAR",0,0,"clauses"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L10",8],["CONST",[]],["RETURN"],["CONST","if"],["SAVE","L9",39],["SAVE","L2",14],["LVAR",0,0,"clauses"],["GVAR","caar"],["CALLJ",1],["SAVE","L8",37],["SAVE","L4",23],["CONST","begin"],["SAVE","L3",21],["LVAR",0,0,"clauses"],["GVAR","cdar"],["CALLJ",1],["GVAR","cons"],["CALLJ",2],["SAVE","L7",35],["SAVE","L6",32],["CONST","cond"],["SAVE","L5",30],["LVAR",0,0,"clauses"],["GVAR","cdr"],["CALLJ",1],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","cond"],["POP"],["CONST","cond"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","length"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L4",8],["CONST",0],["RETURN"],["CONST",1],["SAVE","L3",16],["SAVE","L2",14],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","length"],["CALLJ",1],["GVAR","+"],["CALLJ",2]]]]],["GSET","length"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","map"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L6",8],["CONST",[]],["RETURN"],["SAVE","L3",15],["SAVE","L2",13],["LVAR",0,1,"x"],["GVAR","car"],["CALLJ",1],["LVAR",0,0,"f"],["CALLJ",1],["SAVE","L5",23],["LVAR",0,0,"f"],["SAVE","L4",21],["LVAR",0,1,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","map"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","map"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","not"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["LVAR",0,0,"x"],["FJUMP","L1",5],["CONST",[]],["RETURN"],["GVAR","t"],["RETURN"]]]]],["GSET","not"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","and"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",0],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L8",8],["CONST","t"],["RETURN"],["CONST","if"],["SAVE","L7",32],["SAVE","L2",14],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["SAVE","L6",30],["SAVE","L4",23],["CONST","and"],["SAVE","L3",21],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","cons"],["CALLJ",2],["SAVE","L5",28],["CONST",[]],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","and"],["POP"],["CONST","and"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","or"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",0],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L8",8],["CONST",[]],["RETURN"],["CONST","if"],["SAVE","L7",32],["SAVE","L2",14],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["SAVE","L6",30],["CONST","t"],["SAVE","L5",28],["SAVE","L4",25],["CONST","or"],["SAVE","L3",23],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","or"],["POP"],["CONST","or"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","list"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",0],["LVAR",0,0,"x"],["RETURN"]]]]],["GSET","list"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","append"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L8",8],["LVAR",0,1,"y"],["RETURN"],["SAVE","L2",12],["LVAR",0,1,"y"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L7",15],["LVAR",0,0,"x"],["RETURN"],["GVAR","t"],["FJUMP","L6",31],["SAVE","L3",21],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["SAVE","L5",29],["SAVE","L4",26],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,1,"y"],["GVAR","append"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["GSET","append"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","startswith"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["LVAR",0,1,"sym"],["GVAR","="],["CALLJ",2]]]]],["GSET","startswith"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","atomp"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L8",8],["GVAR","t"],["RETURN"],["SAVE","L2",12],["LVAR",0,0,"x"],["GVAR","numberp"],["CALLJ",1],["FJUMP","L7",15],["GVAR","t"],["RETURN"],["SAVE","L3",19],["LVAR",0,0,"x"],["GVAR","symbolp"],["CALLJ",1],["FJUMP","L6",22],["GVAR","t"],["RETURN"],["SAVE","L4",26],["LVAR",0,0,"x"],["GVAR","stringp"],["CALLJ",1],["FJUMP","L5",29],["GVAR","t"],["RETURN"],["CONST",[]],["RETURN"]]]]],["GSET","atomp"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","qq"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","atomp"],["CALLJ",1],["FJUMP","L37",10],["CONST","quote"],["LVAR",0,0,"x"],["GVAR","list"],["CALLJ",2],["SAVE","L2",15],["LVAR",0,0,"x"],["CONST","quote"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L36",38],["CONST","list"],["SAVE","L7",36],["SAVE","L3",23],["CONST","quote"],["CONST","quote"],["GVAR","list"],["CALLJ",2],["SAVE","L6",34],["SAVE","L5",31],["SAVE","L4",29],["LVAR",0,0,"x"],["GVAR","cadr"],["CALLJ",1],["GVAR","qq"],["CALLJ",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L8",43],["LVAR",0,0,"x"],["CONST","unquote"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L35",47],["LVAR",0,0,"x"],["GVAR","cadr"],["CALLJ",1],["SAVE","L9",52],["LVAR",0,0,"x"],["CONST","quasiquote"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L34",62],["SAVE","L11",60],["SAVE","L10",58],["LVAR",0,0,"x"],["GVAR","cadr"],["CALLJ",1],["GVAR","qq"],["CALLJ",1],["GVAR","qq"],["CALLJ",1],["SAVE","L13",69],["SAVE","L12",67],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["GVAR","consp"],["CALLJ",1],["FJUMP","L18",83],["SAVE","L15",78],["SAVE","L14",75],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["CONST","unquotesplicing"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L16",81],["GVAR","t"],["JUMP","L17",82],["CONST",[]],["JUMP","L19",84],["CONST",[]],["FJUMP","L33",109],["CONST","append"],["SAVE","L25",107],["SAVE","L21",94],["SAVE","L20",92],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["GVAR","cadr"],["CALLJ",1],["SAVE","L24",105],["SAVE","L23",102],["SAVE","L22",100],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","qq"],["CALLJ",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","t"],["FJUMP","L32",135],["CONST","cons"],["SAVE","L31",133],["SAVE","L27",120],["SAVE","L26",118],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["GVAR","qq"],["CALLJ",1],["SAVE","L30",131],["SAVE","L29",128],["SAVE","L28",126],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","qq"],["CALLJ",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["GSET","qq"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","quasiquote"],["GVAR","def"],["CALLJ",1],["POP"],["GVAR","qq"],["GSET","quasiquote"],["POP"],["CONST","quasiquote"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","first"],["GVAR","def"],["CALLJ",1],["POP"],["GVAR","car"],["GSET","first"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","second"],["GVAR","def"],["CALLJ",1],["POP"],["GVAR","cadr"],["GSET","second"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","third"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","second"],["CALLJ",1]]]]],["GSET","third"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","fourth"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","third"],["CALLJ",1]]]]],["GSET","fourth"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","singlep"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","consp"],["CALLJ",1],["FJUMP","L5",19],["SAVE","L3",14],["SAVE","L2",11],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["CONST",[]],["GVAR","="],["CALLJ",2],["FJUMP","L4",17],["GVAR","t"],["RETURN"],["CONST",[]],["RETURN"],["CONST",[]],["RETURN"]]]]],["GSET","singlep"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","maketruelist"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L8",8],["CONST",[]],["RETURN"],["SAVE","L2",12],["LVAR",0,0,"x"],["GVAR","consp"],["CALLJ",1],["FJUMP","L7",26],["SAVE","L3",17],["LVAR",0,0,"x"],["GVAR","car"],["CALLJ",1],["SAVE","L5",24],["SAVE","L4",22],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","maketruelist"],["CALLJ",1],["GVAR","cons"],["CALLJ",2],["GVAR","t"],["FJUMP","L6",31],["LVAR",0,0,"x"],["GVAR","list"],["CALLJ",1],["CONST",[]],["RETURN"]]]]],["GSET","maketruelist"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","dottedp"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L6",8],["CONST",[]],["RETURN"],["SAVE","L2",12],["LVAR",0,0,"x"],["GVAR","consp"],["CALLJ",1],["FJUMP","L5",19],["SAVE","L3",17],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","dottedp"],["CALLJ",1],["GVAR","t"],["FJUMP","L4",23],["GVAR","t"],["RETURN"],["CONST",[]],["RETURN"]]]]],["GSET","dottedp"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","letrec"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["CONST","let"],["SAVE","L5",19],["SAVE","L2",8],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"v"],["GVAR","car"],["CALLJ",1],["CONST",[]],["GVAR","list"],["CALLJ",2]]]]],["LVAR",0,0,"bindings"],["GVAR","map"],["CALLJ",2],["SAVE","L4",17],["SAVE","L3",14],["FN",[["code",[["ARGS",1],["CONST","set"],["LVAR",0,0,"v"],["GVAR","cons"],["CALLJ",2]]]]],["LVAR",0,0,"bindings"],["GVAR","map"],["CALLJ",2],["LVAR",0,1,"body"],["GVAR","append"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","letrec"],["POP"],["CONST","letrec"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","namedlet"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",3],["CONST","letrec"],["SAVE","L10",43],["SAVE","L6",28],["SAVE","L5",25],["LVAR",0,0,"name"],["SAVE","L4",23],["SAVE","L3",20],["CONST","lambda"],["SAVE","L2",18],["SAVE","L1",15],["GVAR","car"],["LVAR",0,1,"init"],["GVAR","map"],["CALLJ",2],["LVAR",0,2,"body"],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["SAVE","L9",41],["SAVE","L8",38],["LVAR",0,0,"name"],["SAVE","L7",36],["GVAR","second"],["LVAR",0,1,"init"],["GVAR","map"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","namedlet"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","simplelet"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L3",14],["CONST","lambda"],["SAVE","L2",12],["SAVE","L1",9],["GVAR","car"],["LVAR",0,0,"bindings"],["GVAR","map"],["CALLJ",2],["LVAR",0,1,"body"],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L5",19],["FN",[["code",[["ARGS",1],["SAVE","L4",5],["LVAR",0,0,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","car"],["CALLJ",1]]]]],["LVAR",0,0,"bindings"],["GVAR","map"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","simplelet"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","let"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["SAVE","L1",5],["LVAR",0,0,"head"],["GVAR","symbolp"],["CALLJ",1],["FJUMP","L4",17],["LVAR",0,0,"head"],["SAVE","L2",11],["LVAR",0,1,"rest"],["GVAR","car"],["CALLJ",1],["SAVE","L3",15],["LVAR",0,1,"rest"],["GVAR","cdr"],["CALLJ",1],["GVAR","namedlet"],["CALLJ",3],["LVAR",0,0,"head"],["LVAR",0,1,"rest"],["GVAR","simplelet"],["CALLJ",2]]]]],["GSET","let"],["POP"],["CONST","let"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","reverse"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L5",8],["LVAR",0,0,"acc"],["RETURN"],["SAVE","L3",16],["SAVE","L2",13],["LVAR",0,1,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",0,0,"acc"],["GVAR","cons"],["CALLJ",2],["SAVE","L4",20],["LVAR",0,1,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",2]]]]],["LSET",0,0,"loop"],["POP"],["CONST",[]],["LVAR",1,0,"x"],["LVAR",0,0,"loop"],["CALLJ",2]]]]],["CALLJ",1]]]]],["GSET","reverse"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","last"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L10",8],["CONST",[]],["RETURN"],["SAVE","L3",15],["SAVE","L2",13],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["GVAR","nilp"],["CALLJ",1],["FJUMP","L9",18],["LVAR",0,0,"tail"],["RETURN"],["SAVE","L5",25],["SAVE","L4",23],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["GVAR","consp"],["CALLJ",1],["FJUMP","L8",32],["SAVE","L6",30],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1],["GVAR","t"],["FJUMP","L7",36],["LVAR",0,0,"tail"],["RETURN"],["CONST",[]],["RETURN"]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",1,0,"x"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["GSET","last"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","when"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["CONST","if"],["SAVE","L4",19],["LVAR",0,0,"p"],["SAVE","L3",17],["SAVE","L1",10],["CONST","begin"],["LVAR",0,1,"body"],["GVAR","cons"],["CALLJ",2],["SAVE","L2",15],["CONST",[]],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","when"],["POP"],["CONST","when"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","unless"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["CONST","if"],["SAVE","L4",19],["LVAR",0,0,"p"],["SAVE","L3",17],["CONST",[]],["SAVE","L2",15],["SAVE","L1",12],["CONST","begin"],["LVAR",0,1,"body"],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","unless"],["POP"],["CONST","unless"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","dolist"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["CONST","let"],["SAVE","L31",125],["SAVE","L7",31],["SAVE","L6",28],["CONST","f"],["SAVE","L5",26],["SAVE","L4",23],["CONST","lambda"],["SAVE","L3",21],["SAVE","L2",18],["SAVE","L1",15],["LVAR",0,0,"binder"],["GVAR","car"],["CALLJ",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["LVAR",0,1,"body"],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["SAVE","L30",123],["SAVE","L29",120],["CONST","let"],["SAVE","L28",118],["CONST","loop"],["SAVE","L27",116],["SAVE","L11",53],["SAVE","L10",50],["CONST","tail"],["SAVE","L9",48],["SAVE","L8",45],["LVAR",0,0,"binder"],["GVAR","second"],["CALLJ",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["SAVE","L26",114],["SAVE","L25",111],["CONST","unless"],["SAVE","L24",109],["SAVE","L13",66],["CONST","nilp"],["SAVE","L12",64],["CONST","tail"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L23",107],["SAVE","L17",84],["CONST","f"],["SAVE","L16",82],["SAVE","L15",79],["CONST","car"],["SAVE","L14",77],["CONST","tail"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L22",105],["SAVE","L21",102],["CONST","loop"],["SAVE","L20",100],["SAVE","L19",97],["CONST","cdr"],["SAVE","L18",95],["CONST","tail"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","dolist"],["POP"],["CONST","dolist"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","dotimes"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["CONST","let"],["SAVE","L34",137],["SAVE","L11",46],["SAVE","L6",28],["CONST","f"],["SAVE","L5",26],["SAVE","L4",23],["CONST","lambda"],["SAVE","L3",21],["SAVE","L2",18],["SAVE","L1",15],["LVAR",0,0,"binder"],["GVAR","car"],["CALLJ",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["LVAR",0,1,"body"],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L10",44],["SAVE","L9",41],["CONST","n"],["SAVE","L8",39],["SAVE","L7",36],["LVAR",0,0,"binder"],["GVAR","second"],["CALLJ",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L33",135],["SAVE","L32",132],["CONST","let"],["SAVE","L31",130],["CONST","loop"],["SAVE","L30",128],["SAVE","L14",65],["SAVE","L13",62],["CONST","i"],["SAVE","L12",60],["CONST",0],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["SAVE","L29",126],["SAVE","L28",123],["CONST","when"],["SAVE","L27",121],["SAVE","L17",82],["CONST","<"],["SAVE","L16",80],["CONST","i"],["SAVE","L15",78],["CONST","n"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L26",119],["SAVE","L19",92],["CONST","f"],["SAVE","L18",90],["CONST","i"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L25",117],["SAVE","L24",114],["CONST","loop"],["SAVE","L23",112],["SAVE","L22",109],["CONST","+"],["SAVE","L21",107],["CONST","i"],["SAVE","L20",105],["CONST",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","dotimes"],["POP"],["CONST","dotimes"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","nth"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"x"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L7",9],["CONST",{s:"nth: index out of range"}],["GVAR","throw"],["CALLJ",1],["SAVE","L2",14],["LVAR",0,0,"n"],["CONST",0],["GVAR","="],["CALLJ",2],["FJUMP","L6",18],["LVAR",0,1,"x"],["GVAR","car"],["CALLJ",1],["GVAR","t"],["FJUMP","L5",31],["SAVE","L3",25],["LVAR",0,0,"n"],["CONST",1],["GVAR","-"],["CALLJ",2],["SAVE","L4",29],["LVAR",0,1,"x"],["GVAR","cdr"],["CALLJ",1],["GVAR","nth"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["GSET","nth"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","member"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["LVAR",0,1,"items"],["FJUMP","L9",28],["SAVE","L1",8],["LVAR",0,1,"items"],["LVAR",0,0,"item"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L6",11],["GVAR","t"],["JUMP","L7",23],["SAVE","L3",19],["LVAR",0,0,"item"],["SAVE","L2",17],["LVAR",0,1,"items"],["GVAR","cdr"],["CALLJ",1],["GVAR","member"],["CALLJ",2],["FJUMP","L4",22],["GVAR","t"],["JUMP","L5",23],["CONST",[]],["FJUMP","L8",26],["GVAR","t"],["RETURN"],["CONST",[]],["RETURN"],["CONST",[]],["RETURN"]]]]],["GSET","member"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","slot"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,0,"ob"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L7",8],["CONST",[]],["RETURN"],["SAVE","L3",16],["SAVE","L2",13],["LVAR",0,0,"ob"],["GVAR","car"],["CALLJ",1],["LVAR",0,1,"tag"],["GVAR","startswith"],["CALLJ",2],["FJUMP","L6",20],["LVAR",0,0,"ob"],["GVAR","car"],["CALLJ",1],["GVAR","t"],["FJUMP","L5",29],["SAVE","L4",26],["LVAR",0,0,"ob"],["GVAR","cdr"],["CALLJ",1],["LVAR",0,1,"tag"],["GVAR","slot"],["CALLJ",2],["CONST",[]],["RETURN"]]]]],["GSET","slot"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","get"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",6],["LVAR",0,0,"ob"],["LVAR",0,1,"tag"],["GVAR","slot"],["CALLJ",2],["FN",[["code",[["ARGS",1],["LVAR",0,0,"s"],["FJUMP","L2",6],["LVAR",0,0,"s"],["GVAR","second"],["CALLJ",1],["CONST",[]],["RETURN"]]]]],["CALLJ",1]]]]],["GSET","get"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","lookup"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"msg"],["GVAR","atomp"],["CALLJ",1],["FJUMP","L9",10],["LVAR",0,0,"ob"],["LVAR",0,1,"msg"],["GVAR","get"],["CALLJ",2],["SAVE","L2",14],["LVAR",0,1,"msg"],["GVAR","consp"],["CALLJ",1],["FJUMP","L8",29],["SAVE","L4",23],["LVAR",0,0,"ob"],["SAVE","L3",21],["LVAR",0,1,"msg"],["GVAR","car"],["CALLJ",1],["GVAR","get"],["CALLJ",2],["SAVE","L5",27],["LVAR",0,1,"msg"],["GVAR","cdr"],["CALLJ",1],["GVAR","apply"],["CALLJ",2],["SAVE","L7",37],["CONST",{s:"lookup: bad msg: "}],["SAVE","L6",35],["LVAR",0,1,"msg"],["GVAR","write"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["GVAR","throw"],["CALLJ",1]]]]],["GSET","lookup"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","cascade"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["SAVE","L1",5],["LVAR",0,1,"msgs"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L5",8],["LVAR",0,0,"ob"],["RETURN"],["SAVE","L3",16],["LVAR",0,0,"ob"],["SAVE","L2",14],["LVAR",0,1,"msgs"],["GVAR","car"],["CALLJ",1],["GVAR","lookup"],["CALLJ",2],["SAVE","L4",20],["LVAR",0,1,"msgs"],["GVAR","cdr"],["CALLJ",1],["GVAR","cascade"],["CALLJ",2]]]]],["GSET","cascade"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","_"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["CONST","cascade"],["SAVE","L10",19],["LVAR",0,0,"ob"],["SAVE","L9",17],["SAVE","L8",14],["CONST","list"],["SAVE","L7",12],["FN",[["code",[["ARGS",1],["SAVE","L1",5],["LVAR",0,0,"msg"],["GVAR","symbolp"],["CALLJ",1],["FJUMP","L6",10],["CONST","quote"],["LVAR",0,0,"msg"],["GVAR","list"],["CALLJ",2],["CONST","list"],["SAVE","L5",26],["SAVE","L3",20],["CONST","quote"],["SAVE","L2",18],["LVAR",0,0,"msg"],["GVAR","car"],["CALLJ",1],["GVAR","list"],["CALLJ",2],["SAVE","L4",24],["LVAR",0,0,"msg"],["GVAR","cdr"],["CALLJ",1],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["LVAR",0,1,"msgs"],["GVAR","map"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","_"],["POP"],["CONST","_"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","new"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",0],["CONST","list"],["SAVE","L6",7],["FN",[["code",[["ARGS",1],["CONST","list"],["SAVE","L5",21],["SAVE","L2",11],["CONST","quote"],["SAVE","L1",9],["LVAR",0,0,"pair"],["GVAR","car"],["CALLJ",1],["GVAR","list"],["CALLJ",2],["SAVE","L4",19],["SAVE","L3",16],["LVAR",0,0,"pair"],["GVAR","second"],["CALLJ",1],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["LVAR",0,0,"pairs"],["GVAR","map"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","new"],["POP"],["CONST","new"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","clone"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",1],["CONST","append"],["SAVE","L3",15],["SAVE","L1",8],["CONST","new"],["LVAR",0,1,"pairs"],["GVAR","cons"],["CALLJ",2],["SAVE","L2",13],["LVAR",0,0,"proto"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","clone"],["POP"],["CONST","clone"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","set_"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",3],["CONST","let"],["SAVE","L34",139],["SAVE","L10",44],["SAVE","L2",13],["CONST","value"],["SAVE","L1",11],["LVAR",0,2,"value"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L9",42],["SAVE","L8",39],["CONST","slotval"],["SAVE","L7",37],["SAVE","L6",34],["CONST","slot"],["SAVE","L5",32],["LVAR",0,0,"obvar"],["SAVE","L4",30],["SAVE","L3",27],["CONST","quote"],["LVAR",0,1,"tag"],["GVAR","list"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L33",137],["SAVE","L32",134],["CONST","if"],["SAVE","L31",132],["CONST","slotval"],["SAVE","L30",130],["SAVE","L18",83],["CONST","begin"],["SAVE","L17",81],["SAVE","L15",74],["CONST","setcdr"],["SAVE","L14",72],["CONST","slotval"],["SAVE","L13",70],["SAVE","L12",67],["CONST","list"],["SAVE","L11",65],["CONST","value"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L16",79],["LVAR",0,0,"obvar"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L29",128],["SAVE","L28",125],["CONST","set"],["SAVE","L27",123],["LVAR",0,0,"obvar"],["SAVE","L26",121],["SAVE","L25",118],["CONST","cons"],["SAVE","L24",116],["SAVE","L22",109],["CONST","list"],["SAVE","L21",107],["SAVE","L19",100],["CONST","quote"],["LVAR",0,1,"tag"],["GVAR","list"],["CALLJ",2],["SAVE","L20",105],["CONST","value"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["SAVE","L23",114],["LVAR",0,0,"obvar"],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","set_"],["POP"],["CONST","set_"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","send"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",2],["CONST","sendmsg"],["SAVE","L7",29],["LVAR",0,0,"pid"],["SAVE","L6",27],["SAVE","L5",24],["CONST","list"],["SAVE","L4",22],["SAVE","L2",16],["CONST","quote"],["SAVE","L1",14],["LVAR",0,1,"msg"],["GVAR","car"],["CALLJ",1],["GVAR","list"],["CALLJ",2],["SAVE","L3",20],["LVAR",0,1,"msg"],["GVAR","cdr"],["CALLJ",1],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["CONST",[]],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2],["GVAR","cons"],["CALLJ",2]]]]],["GSET","send"],["POP"],["CONST","send"],["GVAR","mac"],["CALLJ",1]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","makeimage"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGSD",0],["SAVE","L1",5],["CONST",[]],["GVAR","cellnew"],["CALLJ",1],["SAVE","L2",9],["CONST",{s:"[\n"}],["GVAR","cellnew"],["CALLJ",1],["FN",[["code",[["ARGS",2],["SAVE","L17",5],["FN",[["code",[["ARGS",1],["SAVE","L3",6],["CONST","get"],["LVAR",0,0,"fasl"],["GVAR","http"],["CALLJ",2],["POP"],["RECV",[["response",[["code",[["ARGS",2],["SAVE","L4",6],["LVAR",0,0,"code"],["CONST",200],["GVAR","="],["CALLJ",2],["FJUMP","L7",8],["JUMP","L8",17],["SAVE","L6",16],["SAVE","L5",14],["CONST",{s:"makeimage: http get fail for "}],["LVAR",1,0,"fasl"],["GVAR","strcat"],["CALLJ",2],["GVAR","throw"],["CALLJ",1],["POP"],["LVAR",2,0,"forms"],["SAVE","L11",29],["SAVE","L9",23],["LVAR",2,0,"forms"],["GVAR","cellget"],["CALLJ",1],["SAVE","L10",27],["LVAR",0,1,"text"],["GVAR","fromjson"],["CALLJ",1],["GVAR","append"],["CALLJ",2],["GVAR","cellput"],["CALLJ",2]]]]]],[]]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L12",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L16",8],["CONST",[]],["RETURN"],["SAVE","L14",15],["SAVE","L13",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L15",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["LVAR",3,0,"fasls"],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["SAVE","L23",27],["LVAR",0,1,"image"],["SAVE","L22",25],["SAVE","L18",13],["LVAR",0,1,"image"],["GVAR","cellget"],["CALLJ",1],["SAVE","L21",23],["SAVE","L20",21],["SAVE","L19",19],["LVAR",0,0,"forms"],["GVAR","cellget"],["CALLJ",1],["GVAR","first"],["CALLJ",1],["GVAR","tojson"],["CALLJ",1],["GVAR","strcat"],["CALLJ",2],["GVAR","cellput"],["CALLJ",2],["POP"],["SAVE","L34",32],["FN",[["code",[["ARGS",1],["LVAR",1,1,"image"],["SAVE","L26",14],["SAVE","L24",7],["LVAR",1,1,"image"],["GVAR","cellget"],["CALLJ",1],["CONST",{s:",\n"}],["SAVE","L25",12],["LVAR",0,0,"form"],["GVAR","tojson"],["CALLJ",1],["GVAR","strcat"],["CALLJ",3],["GVAR","cellput"],["CALLJ",2]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L27",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L31",8],["CONST",[]],["RETURN"],["SAVE","L29",15],["SAVE","L28",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L30",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["SAVE","L33",11],["SAVE","L32",9],["LVAR",2,0,"forms"],["GVAR","cellget"],["CALLJ",1],["GVAR","cdr"],["CALLJ",1],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["POP"],["SAVE","L35",37],["LVAR",0,1,"image"],["GVAR","cellget"],["CALLJ",1],["CONST",{s:"\n]\n"}],["GVAR","strcat"],["CALLJ",2]]]]],["CALLJ",2]]]]],["GSET","makeimage"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","writeimage"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L1",7],["CONST","put"],["CONST",{s:"image.fasl"}],["LVAR",0,0,"text"],["GVAR","http"],["CALLJ",3],["POP"],["RECV",[["response",[["code",[["ARGS",1],["SAVE","L2",6],["LVAR",0,0,"code"],["CONST",200],["GVAR","="],["CALLJ",2],["FJUMP","L3",9],["CONST",[]],["RETURN"],["CONST",{s:"writeimage: http put fail"}],["GVAR","throw"],["CALLJ",1]]]]]],[]]]]]],["GSET","writeimage"],["RETURN"]]]],
[["code",[["ARGS",0],["SAVE","L0",5],["CONST","load"],["GVAR","def"],["CALLJ",1],["POP"],["FN",[["code",[["ARGS",1],["SAVE","L2",10],["CONST","get"],["SAVE","L1",8],["LVAR",0,0,"name"],["CONST",{s:".fasl"}],["GVAR","strcat"],["CALLJ",2],["GVAR","http"],["CALLJ",2],["POP"],["RECV",[["response",[["code",[["ARGS",2],["SAVE","L3",6],["LVAR",0,0,"code"],["CONST",200],["GVAR","="],["CALLJ",2],["FJUMP","L11",10],["FN",[["code",[["ARGS",1],["SAVE","L4",5],["LVAR",0,0,"e"],["GVAR","boxfn"],["CALLJ",1],["CALLJ",0]]]]],["FN",[["code",[["ARGS",1],["CONST",[]],["FN",[["code",[["ARGS",1],["FN",[["code",[["ARGS",1],["SAVE","L5",5],["LVAR",0,0,"tail"],["GVAR","nilp"],["CALLJ",1],["FJUMP","L9",8],["CONST",[]],["RETURN"],["SAVE","L7",15],["SAVE","L6",13],["LVAR",0,0,"tail"],["GVAR","car"],["CALLJ",1],["LVAR",2,0,"f"],["CALLJ",1],["POP"],["SAVE","L8",20],["LVAR",0,0,"tail"],["GVAR","cdr"],["CALLJ",1],["LVAR",1,0,"loop"],["CALLJ",1]]]]],["LSET",0,0,"loop"],["POP"],["SAVE","L10",8],["LVAR",2,1,"text"],["GVAR","fromjson"],["CALLJ",1],["LVAR",0,0,"loop"],["CALLJ",1]]]]],["CALLJ",1]]]]],["CALLJ",1],["CONST",[]],["RETURN"]]]]]],[]]]]]],["GSET","load"],["RETURN"]]]],
[["code",[["ARGS",0],["GVAR","startrepl"],["CALLJ",0]]]],
[["code",[["ARGS",0],["GVAR","startsubservience"],["CALLJ",0]]]]
];

/// load!

// FIXME: naive startup
// load();
