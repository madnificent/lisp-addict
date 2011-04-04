function IntroductionCardAssistant() {
}

IntroductionCardAssistant.prototype.setup = function() {
    this.controller.stageController.popScene();
    Mojo.Controller.appController.createStageWithCallback( "introduction-card" , function(sceneController){ sceneController.pushScene("introduction"); } );
};

IntroductionCardAssistant.prototype.activate = function(event) {
};

IntroductionCardAssistant.prototype.deactivate = function(event) {
};

IntroductionCardAssistant.prototype.cleanup = function(event) {
};
