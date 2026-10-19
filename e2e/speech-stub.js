/**
 * Speech stub injected into the page before any app code runs.
 *
 * Headless Chromium ships no Web Speech API, so without this the app would
 * correctly report "unsupported" and no call could be driven. The stub
 * implements the same adapter contract as lib/speech.ts and is installed on
 * window.__SILVERVOICE_SPEECH__ / __SILVERVOICE_SYNTHESIS__, which is the
 * documented swap point.
 *
 * This exercises the real pipeline end to end: adapter callbacks -> recognition
 * hook -> dialogue engine -> guardrails -> ledger -> cards -> TTS. Only the
 * audio itself is simulated.
 */
(function installSpeechStub() {
  var queue = [];
  var spoken = [];
  var started = 0;

  window.__SV_QUEUE__ = queue;
  window.__SV_SPOKEN__ = spoken;
  window.__SV_STATS__ = { get started() { return started; } };

  window.__SV_SAY__ = function (text) {
    queue.push(text);
    return text;
  };

  window.__SILVERVOICE_SPEECH__ = {
    id: "e2e-scripted",
    supported: true,
    _timer: null,
    _stopped: false,
    _callbacks: null,

    start: function (lang, callbacks) {
      var self = this;
      started += 1;
      self._stopped = false;
      self._callbacks = callbacks;
      self._lang = lang;

      if (callbacks.onStart) callbacks.onStart();

      // Continuous session, matching the real adapter: keep polling for the
      // next queued line instead of ending the session after each one. The turn
      // boundary is the hook's job (END_OF_SPEECH_MS), not the adapter's.
      var poll = function () {
        if (self._stopped) return;

        // By default the stub behaves like a polite turn-taker and waits for
        // the assistant to finish before "speaking". Set
        // window.__SV_ALLOW_BARGE_IN__ = true to emit while synthesis is
        // speaking, which exercises barge-in.
        var synth = window.__SILVERVOICE_SYNTHESIS__;
        if (!window.__SV_ALLOW_BARGE_IN__ && synth && synth.speaking) {
          self._timer = setTimeout(poll, 20);
          return;
        }

        if (queue.length > 0) {
          var text = queue.shift();
          if (callbacks.onInterim) callbacks.onInterim(text);
          self._timer = setTimeout(function () {
            if (self._stopped) return;
            if (callbacks.onFinal) callbacks.onFinal(text, 0.95);
            poll();
          }, 10);
          return;
        }
        self._timer = setTimeout(poll, 20);
      };
      self._timer = setTimeout(poll, 10);
    },

    stop: function () {
      this._stopped = true;
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
      if (this._callbacks && this._callbacks.onEnd) this._callbacks.onEnd();
    },

    abort: function () {
      this._stopped = true;
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
    },
  };

  window.__SILVERVOICE_SYNTHESIS__ = {
    id: "e2e-silent",
    supported: true,
    _speaking: false,

    get speaking() {
      return this._speaking;
    },

    getVoices: function () {
      return [
        { name: "E2E Sinji (Cantonese)", lang: "zh-HK", voiceURI: "e2e-yue", localService: true },
        { name: "E2E Tingting (Putonghua)", lang: "zh-CN", voiceURI: "e2e-zh", localService: true },
        { name: "E2E English HK", lang: "en-HK", voiceURI: "e2e-en", localService: true },
      ];
    },

    onVoicesChanged: function () {
      return function () {};
    },

    speak: function (text) {
      var self = this;
      spoken.push(text);
      self._speaking = true;
      // Resolve quickly but not synchronously, so the "speaking" UI state and
      // the re-arm-the-mic-after-speaking path are both genuinely exercised.
      return new Promise(function (resolve) {
        setTimeout(function () {
          self._speaking = false;
          resolve();
        }, 10);
      });
    },

    cancel: function () {
      this._speaking = false;
    },
  };
})();
