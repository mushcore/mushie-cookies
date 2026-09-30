// Register once the game has finished loading, as upstream's loader did.
(function () {
    var waiting = setInterval(function () {
        if (typeof Game !== "undefined" && Game.ready) {
            clearInterval(waiting);
            registerMod("mushie_cookies");
        }
    }, 250);
})();
