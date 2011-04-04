function Model() {

    // --
    // PUBLIC STATE
    // --
    this.eval_lisp = null;
    this.ready = false;


    // --
    // SETTINGS
    // --

    /* Returns the address to which W listens for commands */
    this.getListenerAddress = function() {
	return (new Mojo.Model.Cookie("listener_address")).get() || "http://0.0.0.0:9000"; // pick an inexisting address so we don't execute code by accident
    }.bind(this);

    this.setListenerAddress = function(new_address) {
	Mojo.Log.info("Storing new address: " + new_address );
	(new Mojo.Model.Cookie("listener_address")).put(new_address);
	// set the new address if the evaluator is ready
	if( this.eval_lisp )
	    this.eval_lisp( '(set deviceurl "' + new_address + '")' );
    }.bind(this);



    // --
    // SETUP
    // --

    /* Performs the setup of the lisp image after it's been booted */
    this.lispSetupHook = function( evaluator ) {
	this.eval_lisp = evaluator;
	// set the listener address
	var address = this.getListenerAddress();
	this.eval_lisp( '(set deviceurl "' + address + '")' ,
			function() { Mojo.Log.info("Set the listener address to " + address ); this.ready = true; }.bind(this) );
    }.bind(this);

}

var model = new Model();
var enslave = model.lispSetupHook;