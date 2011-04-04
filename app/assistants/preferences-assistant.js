function PreferencesAssistant() {
}

PreferencesAssistant.prototype.createHandlers = function() {
    // --
    // MODELS
    // --
    this.listenerUrlTxtModel = {
	disabled : false,
	value : model.getListenerAddress()
    };

    this.listenerUrlBtnModel = {
	label : $L("Save"),
	disabled : false,
	buttonClass : "affirmative"
    };

    // --
    // HANDLERS
    // --
    this.updateListenerUrlHandler = function() {
	model.setListenerAddress( this.listenerUrlTxtModel.value );
    }.bind(this);
};

PreferencesAssistant.prototype.setup = function() {
    this.createHandlers();
    
    this.controller.setupWidget( "substanceUrl" ,
				 {} ,
				 this.listenerUrlTxtModel );
    this.controller.setupWidget( "setSubstanceUrlBttn" ,
				 {} ,
				 this.listenerUrlBtnModel );
};

PreferencesAssistant.prototype.activate = function(event) {
    Mojo.Event.listen( this.controller.get( "setSubstanceUrlBttn" ) , Mojo.Event.tap , this.updateListenerUrlHandler );
};

PreferencesAssistant.prototype.deactivate = function(event) {
    Mojo.Event.stopListening( this.controller.get( "setSubstanceUrlBttn" ) , Mojo.Event.tap , this.updateListenerUrlHandler );
};

PreferencesAssistant.prototype.cleanup = function(event) {
};
