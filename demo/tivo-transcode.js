var mindRpc;


var bodyId;



function loadMyShows(stbAddress) {

    if (mindRpc) {
        mindRpc.stop();
    }

    mindRpc = new MindRpc({
        secure: 0,
        host: stbAddress,
        port: 2412
    });

    mindRpc.startMindRpcWebSocket().done(function() {
        var loadMyShowsReqst = {
            bodyId: "-",
            count: 1000,
            deviceType: "webPlayer",
            flatten: true,
            offset: 0,
            filter: { active: true, filterType: "recordings", type: "recordingFilter" },
            type: "myShowsItemSearch"
        };

        mindRpc.request(loadMyShowsReqst, function(response) {
            console.log(response);
    //            $('#loadShows').attr("disabled", false);

            var titleAndRecording = $.map(response.myShowsItem, function(val) {
                var show = val.episodeTitle ? val.title + "("+val.episodeTitle+")" : val.title;
                return { title: show, myShowsItemId: val.myShowsItemId, contentId: val.contentId};
            });

            var sorted = titleAndRecording.sort(function(a, b) {
                return a.title.localeCompare(b.title);
            });

            $('#streamSelect').empty();
            $.each(sorted, function() {
                var $option = $('<option>').text(this.title);
                $option.attr('value', this.myShowsItemId);
                $option.data('msi', this);
                $('#streamSelect').append($option);
            });

        });

        mindRpc.request({type: "bodyConfigSearch"}, function(response) {
            var tsn = response.bodyConfig[0].bodyId;
            bodyId = /^tsn:(.*)/i.exec(tsn)[1];
        })
    });

}


function startHlsSesssion(channelId, recordingId) {
     var hlsSessionRequest = {
         clientUuid: "1234",
         deviceConfiguration: {
             deviceType:"webPlayer",
             type:"deviceConfiguration"
         },
         supportedEncryption: {
             type:"hlsStreamEncryptionInfo",
             encryptionType:"hlsAes128Cbc"
         },
         //hlsStreamDesiredVariantsSet: "ABR",
         sessionType: 'streaming',
         isLocal:true
     };

     if (channelId) {
         hlsSessionRequest.type = "hlsStreamLiveTvRequest";
         hlsSessionRequest.stbChannelId = channelId;
     } else {
         hlsSessionRequest.type = "hlsStreamRecordingRequest";
         hlsSessionRequest.recordingId = recordingId;
     }

     mindRpc.requestMonitoring(hlsSessionRequest, function(response, isFinal) {

         if (isFinal) {
             if (! response.hlsSession) {
                 console.log("Error Response: " + response.errorCode, response);
             } else {

                 console.log("Got playlistUri", response.hlsSession.playlistUri, response);
                 var videoUrl = 'http://' + $('#tcdAddr').val() + ':49152' + response.hlsSession.playlistUri;
                 $('#streamURL').val(videoUrl);
             }
         } else {
             console.log("got non final session request response: %o", response);
         }
     });
 }

