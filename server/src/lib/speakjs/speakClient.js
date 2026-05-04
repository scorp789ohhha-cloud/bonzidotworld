var _____WB$wombat$assign$function_____ = function(name) {return (self._wb_wombat && self._wb_wombat.local_init && self._wb_wombat.local_init(name)) || self[name]; };
if (!self.__WB_pmw) { self.__WB_pmw = function(obj) { this.__WB_source = obj; return this; } }
{
  let window = _____WB$wombat$assign$function_____("window");
  let self = _____WB$wombat$assign$function_____("self");
  let document = _____WB$wombat$assign$function_____("document");
  let location = _____WB$wombat$assign$function_____("location");
  let top = _____WB$wombat$assign$function_____("top");
  let parent = _____WB$wombat$assign$function_____("parent");
  let frames = _____WB$wombat$assign$function_____("frames");
  let opener = _____WB$wombat$assign$function_____("opener");

(function (window, undefined) {
	// Use the correct document accordingly with window argument
	var document = window.document;

	// Define a local copy of speak
	var speak = {};

	// Map over speak in case of overwrite
	var _speak = window.speak;

	// Runs speak.js in no conflict mode, returning the original 'speak'
	// variable to its owner. Returns a reference to this speak object.
	speak.noConflict = function () {
		window.speak = _speak;
		return speak;
	}

	/* Cross-Browser Web Audio API Playback With Chrome And Callbacks */
	// from http://www.masswerk.at/mespeak/

	// alias the Web Audio API AudioContext-object
	var aliasedAudioContext = window.AudioContext || window.webkitAudioContext;
	// ugly user-agent-string sniffing
	var isChrome = ((typeof navigator !== 'undefined') && navigator.userAgent &&
	navigator.userAgent.indexOf('Chrome') !== -1);
	var chromeVersion = (isChrome) ?
	parseInt(
		navigator.userAgent.replace(/^.*?\bChrome\/([0-9]+).*$/, '$1'),
		10
	) : 0;

	// set up a BufferSource-node
	var audioContext = new aliasedAudioContext();

	// Web Worker
	var speakWorker;
	try {
		// https://github.com/yoshi6jp/speak.js/commit/b85d385024f1e20818aa9e3b272c86aa9fc2ebe6
		speakWorker = new Worker(document.querySelector('script[src$="speakClient.js"]').getAttribute('src').replace(/speakClient.js$/, 'speakWorker.js'));
	} catch (e) {
		console.log('speak.js warning: no worker support');
	}

	speak.play = function (text, args, onended, onstart) {
		var source = audioContext.createBufferSource();

		source.stopOld = source.stop;
		source.stop = function() {
			this.stopOld();
			if (this.endTimeout) clearTimeout(this.endTimeout);
		};

		var PROFILE = window._debugSpeak || 0;

		function startSource(source) {
			if (source.start) {
				source.start(0);
			} else {
				source.noteOn(0);
			}
			if (onstart) onstart(source);
		}

		function playSound(streamBuffer) {
			source.connect(audioContext.destination);
			// since the ended-event isn't generally implemented,
			// we need to use the decodeAudioData()-method in order
			// to extract the duration to be used as a timeout-delay
			audioContext.decodeAudioData(streamBuffer, function (audioData) {
				// detect any implementation of the ended-event
				// Chrome added support for the ended-event lately,
				// but it's unreliable (doesn't fire every time)
				// so let's exclude it.
				if (!isChrome && source.onended !== undefined) {
					// we could also use "source.addEventListener('ended', callback, false)" here
					source.onended = onended;
				} else {
					var duration = audioData.duration;
					// convert to msecs
					// use a default of 1 sec, if we lack a valid duration
					var delay = (duration) ? Math.ceil(duration * 1000) : 1000;
					source.endTimeout = setTimeout(onended, delay);
				}
				// finally assign the buffer
				source.buffer = audioData;
				// start playback for Chrome >= 32
				// please note that this would be without effect on iOS, since we're
				// inside an async callback and iOS requires direct user interaction
				if (chromeVersion >= 32) startSource(source)
			},
			function(error) { /* decoding-error-callback */ }
		);
			// normal start of playback, this would be essentially autoplay
			// but is without any effect in Chrome 32
			// let's exclude Chrome 32 and higher to avoid any double calls anyway
			if (!isChrome || chromeVersion < 32) {
				startSource(source);
			}
		}

		function handleWav(wav) {
			var startTime = Date.now();
			var buffer = new ArrayBuffer(wav.length);
			new Uint8Array(buffer).set(wav);
			// TODO: try playAudioDataAPI(data), and fallback if failed
			playSound(buffer);
			if (PROFILE) console.log('speak.js: wav processing took ' + (Date.now() - startTime).toFixed(2) + ' ms');
		}

		if (args && args.noWorker) {
			// Do everything right now. speakGenerator.js must have been loaded.
			var startTime = Date.now();
			var wav = generateSpeech(text, args);
			if (PROFILE) console.log('speak.js: processing took ' + (Date.now() - startTime).toFixed(2) + ' ms');
			playSound(wav);
		} else {
			// Call the worker, which will return a wav that we then play
			var startTime = Date.now();
			speakWorker.onmessage = function (event) {
				if (PROFILE) console.log('speak.js: worker processing took ' + (Date.now() - startTime).toFixed(2) + ' ms');
				handleWav(event.data);
			};
			speakWorker.postMessage({ text: text, args: args });
		}
	};

	// Expose speak to the global object
	window.speak = speak;
})(window);


}
/*
     FILE ARCHIVED ON 21:39:43 Dec 24, 2021 AND RETRIEVED FROM THE
     INTERNET ARCHIVE ON 17:10:02 May 22, 2022.
     JAVASCRIPT APPENDED BY WAYBACK MACHINE, COPYRIGHT INTERNET ARCHIVE.

     ALL OTHER CONTENT MAY ALSO BE PROTECTED BY COPYRIGHT (17 U.S.C.
     SECTION 108(a)(3)).
*/
/*
playback timings (ms):
  captures_list: 1555.161
  exclusion.robots: 0.148
  exclusion.robots.policy: 0.136
  RedisCDXSource: 0.701
  esindex: 0.009
  LoadShardBlock: 1531.377 (3)
  PetaboxLoader3.datanode: 84.239 (4)
  CDXLines.iter: 20.006 (3)
  PetaboxLoader3.resolve: 1885.243 (2)
  load_resource: 546.328
*/