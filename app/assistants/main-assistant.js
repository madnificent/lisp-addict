function MainAssistant() {
}

var enslave = function( lispEvaluator ) {
    Mojo.Log.info("Calling enslave");
    MainAssistant.prototype.evalLisp = lispEvaluator;
}.bind(this);

MainAssistant.prototype.setupHandlers = function () {
    // --
    // Model
    // --
    this.evalLisp = null;
    this.codeinModel = { value : "" , disabled : false };
    this.codeoutModel = { value : "" , disabled : true };

    // --
    // Handlers
    // --
    this.placeOutputHandler = function(output) {
	Mojo.Log.info("Placing output " + output);
	this.codeoutModel.value = output;
	this.controller.modelChanged( this.codeoutModel );
    }.bind(this);
    
    enslave = function( lispEvaluator ){
	Mojo.Log.info("Calling enslave function");
	this.evalLisp = lispEvaluator;
    }.bind(this);

    this.evaluateHandler = function() {
	if( this.evalLisp) {
	    var code = this.codeinModel.value;
	    Mojo.Log.info("Evaluating " + code);
	    this.evalLisp( code , this.placeOutputHandler);
	} else {
	    Mojo.Log.info("Not ready to evaluate yet");
	}
    }.bind(this);

    this.resetHandler = function() {
	this.codeinModel.value = "";
	this.controller.modelChanged( this.codeinModel );
	this.codeoutModel.value = "";
	this.controller.modelChanged( this.codeoutModel );
    }.bind(this);
};

MainAssistant.prototype.setup = function() {
    this.setupHandlers();
    this.setupWidgets();
    this.setupMenu();
    Mojo.Log.info("Ready to load the image");
    load();
};

MainAssistant.prototype.activate = function(event) {
};

MainAssistant.prototype.deactivate = function(event) {
};

MainAssistant.prototype.cleanup = function(event) {
};


MainAssistant.prototype.setupWidgets = function () {
    Mojo.Log.info("Setting up widgets");
    this.controller.setupWidget( "codein" ,
				 {
				     multiline: true,
				     autoFocus: true,
				     autoResize: true,
				     growWidth: true,
				     autoReplace: false,
				     textCase: Mojo.Widget.steModeLowerCase
				 } ,
				 this.codeinModel );
    this.controller.setupWidget( "codeout" , 
				 {
				     multiline: true,
				     autoFocus: false,
				     autoResize: true,
				     growWidth: true,
				     autoReplace: false,
				     textCase: Mojo.Widget.steModeLowerCase
				 } , 
				 this.codeoutModel );
};

MainAssistant.prototype.setupMenu = function() {
    Mojo.Log.info("Setting up menu");
    this.controller.setupWidget(Mojo.Menu.commandMenu, 
    				undefined, 
    				{ 
    				    visible : true,
    				    items: [ { label : $L('Evaluate'), command: 'evaluate' },
    					     { label : $L('Reset'), command: 'reset' } ]
    				});
};

MainAssistant.prototype.handleCommand = function(e) {
    Mojo.Log.info("Main is trying to handle a command");
    if (e.type == Mojo.Event.commandEnable && (e.command == Mojo.Menu.helpCmd)) {
        e.stopPropagation();
    }
    if( e.type == Mojo.Event.command )
    {
	switch(e.command) {
	case "evaluate":
	    this.evaluateHandler();
	    break;
	case "reset":
	    Mojo.Log.info("Calling reset");
	    this.resetHandler();
	    break;
	case Mojo.Menu.helpCmd:
            Mojo.Controller.stageController.pushAppSupportInfoScene();
            break;
	}
    }
}
