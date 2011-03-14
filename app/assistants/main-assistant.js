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

    // --
    // Handlers
    // --
    this.placeOutputHandler = function(output) {
	Mojo.Log.info("Placing output");
	this.controller.get( "textout" ).innerHTML = output;
    }.bind(this);
    
    enslave = function( lispEvaluator ){
	Mojo.Log.info("Calling enslave function");
	this.evalLisp = lispEvaluator;
    }.bind(this);

};

MainAssistant.prototype.setup = function() {
    this.setupHandlers();
    this.setupWidgets();
    this.setupMenu();
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
    this.controller.setupWidget( "textin" , {} , {} );
    this.controller.setupWidget( "textout" , {} , {} );
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
    if( e.type == Mojo.Event.command )
    {
	switch(e.command) {
	case "evaluate":
	    Mojo.Log.info("Calling evaluate");
	    if( this.evalLisp) {
		Mojo.Log.info("Evaluating " + this.controller.get("textin").innerHTML);
		this.evalLisp( this.controller.get("textin").innerHTML , function(r){ Mojo.Log.info("Calling output with " + r); this.placeOutputHandler(r);}.bind(this) );
	    } else {
		Mojo.Log.info("Not ready to evaluate yet");
	    }
	    break;
	case "reset":
	    Mojo.Log.info("Calling reset");
	    this.controller.get("textout").innerHTML = "";
	    this.controller.get("textin").innerHTML = "";
	    break;
	}
    }
}
