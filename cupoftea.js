var _ = require('underscore');
var sys = require('sys');

var debug = function (msg) {
    //console.log(msg);
};

var d = function (msg) {
    console.log(msg);
};

var SpecDefinition = function (desc, parentSpec, index) {
    var childSpecs = [];
    var specsRun = 0;

    var findChildSpecByDescription = function (desc) {
        debug('childSpecs:');
        _(childSpecs).each(function (spec) {
            debug('spec: ' + spec.description() + ' === ' + desc + ': ' + (spec.description() === desc));
        });
        return _(childSpecs).detect(function (spec) {
            return spec.description() === desc;
        });
    };

    return {
        addSpec: function (desc, definition) {
            var existingSpec = findChildSpecByDescription(desc);
            if (existingSpec) {
                debug('found spec: ' + existingSpec.description());
                debug('specs run: ' + specsRun);
                debug('spec index: ' + existingSpec.index());
                if (existingSpec.index() === specsRun) {
                    currentRunStack.pushCurrentSpec(existingSpec, definition);
                }
            } else {
                var childSpec = new SpecDefinition(desc, this, childSpecs.length);
                childSpecs.push(childSpec);
                debug('adding spec: ' + childSpec.description());
                debug('specs run: ' + specsRun);
                debug('spec index: ' + childSpec.index());
                if (childSpec.index() === specsRun) {
                    currentRunStack.pushCurrentSpec(childSpec, definition);
                }
            }
        },
        fullDescription: function () {
            var getParentDesc = function () {
                var parentDesc = parentSpec.fullDescription();
                if (parentDesc) {
                    return parentDesc + ' ';
                } else {
                    return '';
                }
            };

            return getParentDesc() + desc;
        },
        description: function () {
            return desc;
        },
        parent: function () {
            return parentSpec;
        },
        isFinished: function () {
            var finished = _(childSpecs).all(function (spec) {
                return spec.isFinished();
            });
            debug('spec: ' + desc + ' is finished: ' + finished);
            return finished && specsRun === childSpecs.length;
        },
        end: function () {
            if (childSpecs.length > specsRun && childSpecs[specsRun].isFinished()) {
                specsRun++;
            }
        },
        index: function () {
            return index;
        }
    };
};

var TopSpec = function (runStack) {
    return {
        addSpec: function (desc, definition) {
            debug('starting with spec: ' + desc);
            var spec = new SpecDefinition(desc, this, 0);
            var timesRun = 0;
            do {
                timesRun++;
                debug('times run: ' + timesRun);
                runStack.runSpec(function () {
                    runStack.pushCurrentSpec(spec, definition);
                },function (spec, exception) {
                    if (!exception) {
                        sys.print(spec.fullDescription() + " [0;32;40mOK[0m\n");
                    } else {
                        sys.print(spec.fullDescription() + " [0;31mFAILED[0m\n");
                        sys.print(exception + "\n");
                    }
                });
            } while (!spec.isFinished());
        },
        end: function () {
        },
        fullDescription: function () {
            return undefined;
        },
        description: function () {
            return 'top level';
        }
    }
};

var Callbacks = function (runStack) {
    var numberOfCallbacks = 0;
    var currentSpecResultsCalled = false;
    var hasCallbacks = false;

    var results = function (exception) {
        if (!currentSpecResultsCalled) {
            runStack.results(exception);
            currentSpecResultsCalled = true;
        }
    };

    this.shouldNotCall = function () {
        hasCallbacks = true;
        var error = new Error("shouldn't be called");
        return function () {
            results(error);
        };
    };

    this.shouldCall = function (f) {
        hasCallbacks = true;
        numberOfCallbacks++;
        return function () {
            numberOfCallbacks--;
            try {
                var result = f.apply(null, arguments);
            } catch (e) {
                results(e);
                expectedExceptions.push(e);
                throw e;
            }

            if (numberOfCallbacks === 0) {
                results();
            }

            return result;
        };
    };

    this.hasCallbacks = function () {
        return hasCallbacks;
    };

    this.assertCallbacks = function () {
        if (numberOfCallbacks > 0) {
            results('not called');
        } else if (hasCallbacks) {
            results();
        }
    };
};

var expectedExceptions = [];

var RunStack = function () {
    var callbacks = new Callbacks(this);
    var deepestSpec;
    var currentSpec;

    this.spec = function (desc, definition) {
        currentSpec.addSpec(desc, definition);
    };

    this.pushCurrentSpec = function (newSpec, definition) {
        var oldCurrentSpec = currentSpec;
        deepestSpec = currentSpec = newSpec;
        try {
            definition();
        } finally {
            currentSpec.end();
            currentSpec = oldCurrentSpec;
        }
    };

    this.run = function (spec, definition) {
        try {
            this.pushCurrentSpec(spec, definition);
            if (!callbacks.hasCallbacks()) {
                this.results();
            }
        } catch (e) {
            this.results(e);
        }
    };

    this.shouldCall = function (f) {
        return callbacks.shouldCall(f);
    };

    this.shouldNotCall = function () {
        return callbacks.shouldNotCall();
    };

    this.assertAllCallbacks = function () {
        callbacks.assertCallbacks();
    };

    this.results = function (exception) {
        var desc = deepestSpec.fullDescription();
        if (!exception) {
            sys.print(desc + " [0;32;40mOK[0m\n");
        } else {
            sys.print(desc + " [0;31mFAILED[0m\n");
            if (exception.stack) {
                sys.print(exception.stack + "\n");
            } else {
                sys.print(exception + "\n");
            }
            sys.print("\n");
        }
    };
};

var TopLevelRunStack = function () {
    this.spec = function (desc, definition) {
        var spec = new SpecDefinition(desc, new TopSpec(this), 0);

        do {
            currentRunStack = new RunStack();
            runStacks.push(currentRunStack);
            currentRunStack.run(spec, definition);
        } while (!spec.isFinished());

        currentRunStack = this;
    };
};

var currentRunStack = new TopLevelRunStack();
var runStacks = [];

spec = function (desc, definition) {
    currentRunStack.spec(desc, definition);
};

shouldNotCall = function () {
    return currentRunStack.shouldNotCall();
};

shouldCall = function (f) {
    return currentRunStack.shouldCall(f);
};

process.addListener('exit', function () {
    //console.log('exiting');
    _(runStacks).each(function (runStack) {
        runStack.assertAllCallbacks();
    });
});

process.on('uncaughtException', function(err) {
    if (!_(expectedExceptions).contains(err)) {
        throw err;
    }
});
