//////////////////////////////////////////////////////////////////////
//
// File: MindRpc.js
//
// Copyright 2016 TiVo Inc. All Rights Reserved.
//
//////////////////////////////////////////////////////////////////////

/*global MindRpc*/              // MindRpc.js
/*global debug*/                // console_wrapper.js

(function(factory, $, debug) {
    factory.MindRpc = function(config) {
        this.mSchemaVersion = 22;
        this.mSecure = 0;
        this.mPort = 0;
        this.mStandardHeaders = ["Content-type: application/json"];
        this.mWs = null;
        this.mMaxRpcId = 0;
        this.mListeners = {};

        config = config || {};

        if (!!config.secure) {
            this.mSecure = config.secure;
        }
        if (!!config.host) {
            this.mHost = config.host;
        }
        if (!!config.port) {
            this.mPort = config.port;
        }
        if (!!config.schemaVersion) {
            this.mSchemaVersion = config.schemaVersion;
        }
        if (!!config.appName) {
            this.mStandardHeaders.push("ApplicationName: " + config.appName);
        }
        if (!!config.appVersion) {
            this.mStandardHeaders.push("ApplicationVersion: " + config.appVersion);
        }
        if (!!config.appSessionId) {
            this.mStandardHeaders.push("ApplicationSessionId: " + config.appSessionId);
        }
        if (!!config.hwPlatform) {
            this.mStandardHeaders.push("HardwarePlatform: " + config.hwPlatform);
        }
        if (!!config.hwId) {
            this.mStandardHeaders.push("HardwareIdentifier: " + config.hwId);
        }

        // empty line separator (need two to get final \r\n)
        this.mStandardHeaders.push("");
        this.mStandardHeaders.push("");
    };

    $.extend(MindRpc.prototype, {

        /**
         * Returns a promise to start the webSocket.
         *
         * The promise resolves when the socket is opened (transitions to readyState 1) and rejects if the
         * WebSocket fails to open right out of the gate.
         *
         * If the websocket subsequently is closed by the remote peer, or has any other kind of error then the
         * onclose or onerror methods are called.
         *
         * Promise state:
         *  - progress:  {state: [open, authenticated, failed], mindRpc: this}
         *
         * @returns {*}
         */
        startMindRpcWebSocket: function() {
            var result = new $.Deferred();
            var self = this;


            if (!("WebSocket" in window)) {
                var message = "WebSocket not supported by your browser!";
                debug.error(message);
                result.reject(-1, message);
            } else {

                self.stop();

                self._url = (this.mSecure ? "wss" : "ws") + "://";
                self._url += this.mHost + (this.mPort ? (":" + this.mPort) : "");

                try {
                    this.mWs = new WebSocket(self._url, "com.tivo.mindrpc.2");
                }
                catch (err) {
                    result.reject(-1, "WebSocket create failed" + err);
                    debug.error("Unable to open websocket to "+self._url+" ", err);
                }

                this.mWs.onopen = function() {
                    if (result.state() === "pending") {
                        result.resolve(self);
                    }
                };
                this.mWs.onmessage = function(event) {
                    self.onmessage(event);
                };
                this.mWs.onerror = function(event) {
                    debug.log("Websocket to "+self._url+" onerror, event code: "+event.code);

                    self.onerror(event);
                };
                this.mWs.onclose = function(event) {
                    debug.log("Websocket to "+self._url+" onclose, event code: "+event.code);

                    self.onclose(event);

                    self.mWs = null;
                    self.mMaxRpcId = 0;
                    self.mListeners = {};

                    if (event.code === 1006) {
                        debug.log('onclose', event.code);
                        // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
                        result.reject(-1006, "Websocket abnormal close");
                    }
                };
            }

            if (self.mWs.readyState === 1 && result.state() === "pending") {
                result.resolve(self);
            }

            return result.promise();
        },

        stop: function() {
            var self = this;

            if (self.mWs) {
                debug.log("Closing MindRrc websocket to %s ", self.mHost);

                try {
                    self.mWs.close();
                    debug.log("Close success");

                } catch (err) {
                    debug.error("Unable to close websocket: " + err);
                }
                self.mWs = null;
                self.mMaxRpcId = 0;
                self.mListeners = {};
            }
        },

        isPendingRequests: function() {
            var self = this;
            var isPendingRequest = false;

            for (var rpcId in self.mListeners) {
                if (self.mListeners[rpcId] !== null) {
                    isPendingRequest = true;
                    break;
                }
            }
            return isPendingRequest;
        },

        request: function(mdo, listener, extraHeaders) {
            var rpcId = ++this.mMaxRpcId;

            this.mListeners[rpcId] = listener;

            this.sendRequest("request", rpcId, mdo, "single", extraHeaders);
            return rpcId;
        },

        requestMonitoring: function(mdo, listener, extraHeaders) {
            var rpcId = ++this.mMaxRpcId;

            this.mListeners[rpcId] = listener;

            this.sendRequest("request", rpcId, mdo, "multiple", extraHeaders);
            return rpcId;
        },

        fireAndForget: function(mdo, extraHeaders) {
            this.sendRequest("request", ++this.mMaxRpcId, mdo, "none", extraHeaders);
        },

        requestUpdate: function(rpcId, mdo, extraHeaders) {
            this.sendRequest("requestUpdate", rpcId, mdo, null, extraHeaders);
        },

        cancelRequest: function(rpcId, extraHeaders) {
            var headerArray = [
                "Type: cancel",
                "RpcId: " + rpcId,
                "", "" // need two to get final \r\n
            ];

            extraHeaders = extraHeaders || {};

            // Use the default schema version if none is specified in the extra headers.
            extraHeaders.SchemaVersion = extraHeaders.SchemaVersion || this.mSchemaVersion;

            for (var headerName in extraHeaders) {
                // Only add in a header if it has an actual value.
                if (extraHeaders[headerName]) {
                    headerArray.push(headerName + ": " + extraHeaders[headerName]);
                }
            }

            var header = headerArray.join("\r\n");
            var msg = "MRPC/2 " + header.length + " 0\r\n" + header;

            try {
                this.mWs.send(msg);
            } catch (e) {
                debug.log("ignoring error sending MindRPC cancel request. WS readyState %d", this.mWs, e);
            }

            // forget listener
            this.mListeners[rpcId] = null;
        },

        sendRequest: function(type, rpcId, mdo, responseCount, extraHeaders) {
            var headerArray = [
                "Type: " + type,
                "RpcId: " + rpcId,
                "RequestType: " + mdo.type,
                "ResponseCount: " + responseCount
            ];

            extraHeaders = extraHeaders || {};

            // Backwards compatibility.
            if (typeof extraHeaders === "string") {
                extraHeaders = {
                    ApplicationFeatureArea: extraHeaders
                };
            }

            // Use the default schema version if none is specified in the extra headers.
            extraHeaders.SchemaVersion = extraHeaders.SchemaVersion || this.mSchemaVersion;

            // Use the bodyId specified in the request, and fall back to one specified in the extraHeaders.
            extraHeaders.BodyId = mdo.bodyId || extraHeaders.BodyId;

            for (var headerName in extraHeaders) {
                // Only add headers that have an actual value.
                if (extraHeaders[headerName]) {
                    headerArray.push(headerName + ": " + extraHeaders[headerName]);
                }
            }

            headerArray = headerArray.concat(this.mStandardHeaders);

            var header = headerArray.join("\r\n");

            var body = JSON.stringify(mdo);

            var msg = "MRPC/2 " + header.length + " " + body.length + "\r\n" + header + body;

            try {
                this.mWs.send(msg);
            } catch (e) {
                debug.error("Websocket send to "+this._url+" failed: ", e);
                this.onerror();
            }
        },

        onmessage: function(event) {
            // parse pre-header
            var preheader = String(event.data.split("\r\n", 1));
            var preheaderParts = preheader.split(" ");

            // extract header
            var header = event.data.substr(preheader.length + 2 /* skip newline */,
                preheaderParts[1] - 4 /* ignore blank line */);

            // extract body
            var body = event.data.substr(preheader.length + 2 /* skip newline */ + Number(preheaderParts[1]));

            if (String(body.length) !== preheaderParts[2]) {
                debug.warn("Marshalled data mismatch: body length = " + body.length + ", header said = " + preheaderParts[2]);
            }

            // parse header for RpcId and IsFinal
            var headerParts = header.split("\r\n");
            var rpcId = 0;
            var isFinal = true;
            for (var i in headerParts) {
                var headerPart = headerParts[i];
                var tag = headerPart.split(":", 1)[0];
                if (tag === "RpcId") {
                    rpcId = parseInt(headerPart.slice(6), 10);
                }

                if (tag === "IsFinal") {
                    isFinal = (headerPart.slice(8).trim() === 'true');
                }
            }

            if (rpcId > 0 && this.mListeners[rpcId]) {
                // unmarshal response
                var mdo;
                try {
                    mdo = JSON.parse(body);
                } catch (e) {
                    debug.warn("Unparseable JSON body for RPCid: "+rpcId+" error:", e);
                }
                this.mListeners[rpcId](mdo, isFinal, headerParts);
                if (isFinal) {
                    // clear listener if no more responses
                    this.mListeners[rpcId] = null;
                }
            }
        },

        onclose: function(event) { }, // JS eq. to pure virtual, this is overwritten by MindClient

        onerror: function(event) { } // JS eq. to pure virtual, this is overwritten by MindClient
    });
})(window, jQuery, debug);



