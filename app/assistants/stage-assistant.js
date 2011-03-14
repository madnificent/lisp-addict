function StageAssistant() {
}

StageAssistant.prototype.setup = function() {
    this.controller.pushScene("main");
};


StageAssistant.prototype.handleCommand = function(e) {
    switch( e.type ) {
    case Mojo.Event.commandEnable:
        if( e.command )
	    e.stopPropagation();
	break;
    }
}