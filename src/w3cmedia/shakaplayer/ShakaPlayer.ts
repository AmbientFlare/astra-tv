// @ts-nocheck
/*
 * Copyright 2022 - 2025 Amazon.com, Inc. or its affiliates. All rights reserved.
 *
 * AMAZON PROPRIETARY/CONFIDENTIAL
 *
 * You may not use this file except in compliance with the terms and
 * conditions set forth in the accompanying LICENSE.TXT file.
 *
 * THESE MATERIALS ARE PROVIDED ON AN "AS IS" BASIS. AMAZON SPECIFICALLY
 * DISCLAIMS, WITH RESPECT TO THESE MATERIALS, ALL WARRANTIES, EXPRESS,
 * IMPLIED, OR STATUTORY, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
 */

// @ts-nocheck
import {HTMLMediaElement} from '@amazon-devices/react-native-w3cmedia/dist/headless';
import {Platform} from 'react-native';
import {PlayerInterface} from '../PlayerInterface';
import shaka from './dist/shaka-player.compiled';

// import polyfills
import Document from '../polyfills/DocumentPolyfill';
import DOMParserPolyfill from '../polyfills/DOMParserPolyfill';
import Element from '../polyfills/ElementPolyfill';
import MiscPolyfill from '../polyfills/MiscPolyfill';
import TextDecoderPolyfill from '../polyfills/TextDecoderPolyfill';
import W3CMediaPolyfill from '../polyfills/W3CMediaPolyfill';
import {BufferOperationTracker} from '../bufferOperationTracker';
import {trimHlsMediaPlaylistForResume} from '../hlsResumePlaylist';

// install polyfills
Document.install();
Element.install();
TextDecoderPolyfill.install();
W3CMediaPolyfill.install();
MiscPolyfill.install();
DOMParserPolyfill.install();

const playerName: string = 'shaka';
const playerVersion: string = '4.8.5';

export interface ShakaPlayerSettings {
  secure: boolean;
  abrEnabled: boolean;
  abrMaxWidth?: number;
  abrMaxHeight?: number;
  hlsSequenceMode?: boolean;
  hlsIgnoreManifestTimestampsInSegmentsMode?: boolean;
  hlsResumePositionSeconds?: number;
}

export class ShakaPlayer implements PlayerInterface {
  player: shaka.Player;
  private setting_: ShakaPlayerSettings;
  private mediaElement: HTMLMediaElement | null;
  private bufferOperations = new BufferOperationTracker();
  private appendHooksCleanup: (() => void) | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  static readonly enableNativeParsing = false;
  static readonly enableNativeXmlParsing = false;

  constructor(
    mediaElement: HTMLMediaElement | null,
    setting: ShakaPlayerSettings,
  ) {
    this.mediaElement = mediaElement;
    this.setting_ = setting;
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.lifecycleQueue.then(operation, operation);
    this.lifecycleQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Wait for SourceBuffer work already handed to the native pipeline. */
  async waitForAppendComplete(): Promise<void> {
    await this.bufferOperations.waitForComplete();
  }

  private wrapSourceBuffer(sourceBuffer: any): void {
    if (!sourceBuffer || sourceBuffer.__astraAppendGate) {
      return;
    }

    sourceBuffer.__astraAppendGate = true;
    const originalAppendBuffer = sourceBuffer.appendBuffer?.bind(sourceBuffer);
    const originalRemove = sourceBuffer.remove?.bind(sourceBuffer);
    const originalAbort = sourceBuffer.abort?.bind(sourceBuffer);

    if (originalAppendBuffer) {
      sourceBuffer.appendBuffer = (data: ArrayBuffer | ArrayBufferView) => {
        this.bufferOperations.track(
          sourceBuffer,
          () => originalAppendBuffer(data),
          true,
        );
      };
    }

    if (originalRemove) {
      sourceBuffer.remove = (start: number, end: number) => {
        this.bufferOperations.track(
          sourceBuffer,
          () => originalRemove(start, end),
          false,
        );
      };
    }

    if (originalAbort) {
      sourceBuffer.abort = () => {
        this.bufferOperations.track(
          sourceBuffer,
          () => originalAbort(),
          false,
        );
      };
    }
  }

  private installAppendHooks(): void {
    const constructors = [
      global.MediaSource,
      global.window?.MediaSource,
      global.ManagedMediaSource,
      global.window?.ManagedMediaSource,
    ].filter(Boolean);
    const restorers: Array<() => void> = [];

    Array.from(new Set(constructors)).forEach((MediaSourceConstructor: any) => {
      const prototype = MediaSourceConstructor.prototype;
      const addSourceBuffer =
        prototype?.__astraOriginalAddSourceBuffer ?? prototype?.addSourceBuffer;
      if (typeof addSourceBuffer !== 'function') {
        return;
      }

      prototype.__astraOriginalAddSourceBuffer = addSourceBuffer;

      const player = this;
      const wrappedAddSourceBuffer = function (...args: any[]) {
        const sourceBuffer = addSourceBuffer.apply(this, args);
        player.wrapSourceBuffer(sourceBuffer);
        return sourceBuffer;
      };
      prototype.addSourceBuffer = wrappedAddSourceBuffer;
      restorers.push(() => {
        if (prototype.addSourceBuffer === wrappedAddSourceBuffer) {
          prototype.addSourceBuffer = addSourceBuffer;
          delete prototype.__astraOriginalAddSourceBuffer;
        }
      });
    });

    this.appendHooksCleanup = () => {
      restorers.forEach((restore) => restore());
      this.appendHooksCleanup = null;
    };
  }

  // Custom callbacks {{{
  // This whole section is a port from shakaplayer demo app
  /**
   * A prefix retrieved in a manifest response filter and used in a subsequent
   * license request filter.  Necessary for VDMS content.
   *
   * @type {string}
   */
  private lastUplynkPrefix: string = '';

  /**
   * A response filter for VDMS Uplynk manifest responses.
   * This allows us to get the license prefix that is necessary
   * to later generate a proper license response.
   *
   * @param {shaka.net.NetworkingEngine.RequestType} type
   * @param {shaka.extern.Response} response
   */
  uplynkResponseFilter(
    type: shaka.net.NetworkingEngine.RequestType,
    response: shaka.extern.Response,
  ): void {
    console.log(`sample:shaka: in the response filter type = ${type}`);
    if (type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
      console.log('sample:shaka: in the response filter MANIFEST');
      // Parse a custom header that contains a value needed to build a proper
      // license server URL.
      if (response.headers['x-uplynk-prefix']) {
        this.lastUplynkPrefix = response.headers['x-uplynk-prefix'];
        console.log(
          `sample:shaka: in the response filter update Prefix to ${this.lastUplynkPrefix}`,
        );
      } else {
        this.lastUplynkPrefix = '';
      }
    }
  }

  /**
   * A license request filter for VDMS Uplynk license requests.
   *
   * @param {shaka.net.NetworkingEngine.RequestType} type
   * @param {shaka.extern.Request} request
   */
  uplynkRequestFilter(
    type: shaka.net.NetworkingEngine.RequestType,
    request: shaka.extern.Request,
  ): void {
    console.log(`sample:shaka: in the request filter type = ${type}`);
    if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
      console.log('sample:shaka: in the request filter LICENSE');
      // Modify the license request URL based on our cookie.
      if (request.uris[0].includes('wv') && this.lastUplynkPrefix) {
        console.log('sample:shaka: in the request filter LICENSE WV');
        request.uris[0] = this.lastUplynkPrefix.concat('/wv');
      } else if (request.uris[0].includes('ck') && this.lastUplynkPrefix) {
        request.uris[0] = this.lastUplynkPrefix.concat('/ck');
      } else if (request.uris[0].includes('pr') && this.lastUplynkPrefix) {
        console.log('sample:shaka: in the request filter LICENSE PR');
        request.uris[0] = this.lastUplynkPrefix.concat('/pr');
      }
    }
    console.log('sample:shaka: in the request filter END');
  }

  /**
   * @param {!Map.<string, string>} headers
   * @param {shaka.net.NetworkingEngine.RequestType} requestType
   * @param {shaka.extern.Request} request
   * @private
   */
  addLicenseRequestHeaders_(
    headers: Map<string, string>,
    requestType: shaka.net.NetworkingEngine.RequestType,
    request: shaka.extern.Request,
  ) {
    if (requestType !== shaka.net.NetworkingEngine.RequestType.LICENSE) {
      return;
    }

    // Add these to the existing headers.  Do not clobber them!
    // For PlayReady, there will already be headers in the request.
    headers.forEach((value, key) => {
      request.headers[key] = value;
    });
  }

  /**
   * @param {!Map.<string, string>} headers
   * @param {shaka.net.NetworkingEngine.RequestType} requestType
   * @param {shaka.extern.Request} request
   * @private
   */
  addManifestRequestHeaders_(
    headers: Map<string, string>,
    requestType: shaka.net.NetworkingEngine.RequestType,
    request: shaka.extern.Request,
  ) {
    if (
      requestType === shaka.net.NetworkingEngine.RequestType.MANIFEST ||
      requestType === shaka.net.NetworkingEngine.RequestType.SEGMENT
    ) {
      // Add these to the existing headers.  Do not clobber them!
      headers.forEach((value, key) => {
        request.headers[key] = value;
      });
    }
  }

  async nativeParsePlaylist(
    manifest: ArrayBuffer,
    absoluteuri: string,
  ): Promise<Array<shaka.hls.Playlist>> {
    console.log('shaka: nativeParsePlaylist+');
    const playlist = await global.parseHlsManifest(
      playerName,
      playerVersion,
      absoluteuri,
      manifest,
      shaka,
    );
    console.log('shaka: nativeParsePlaylist-');
    return playlist;
  }

  nativeParseFromString(
    manifest: ArrayBuffer,
    expectedRoot: string,
  ): Array<shaka.hls.Playlist> {
    console.log('shaka: nativeParseFromString+');
    console.log('shaka: nativeParseFromString: expectedRoot ', expectedRoot);
    const playlist = global.nativeParseFromString(manifest, expectedRoot);
    console.log('shaka: nativeParseFromString-');
    return playlist;
  }
  // End custom callbacks }}}

  async load(content: any, _autoplay: boolean): Promise<void> {
    return this.enqueueLifecycle(() => this.loadInternal(content, _autoplay));
  }

  private async loadInternal(content: any, _autoplay: boolean): Promise<void> {
    await this.waitForAppendComplete();
    this.installAppendHooks();

    // Native HLS parsing setup
    if (ShakaPlayer.enableNativeParsing) {
      if (
        global.registerNativePlayerUtils &&
        shaka.hls.HlsParser.setNativeFunctions
      ) {
        console.log('shakaplayer: registerNativePlayerUtils found');
        if (!global.isNativeHlsParserSupported) {
          const ret = global.registerNativePlayerUtils();
          console.log('shaka: native functions registered: ' + ret);
        }
        if (
          global.isNativeHlsParserSupported &&
          global.parseHlsManifest &&
          global.nativeShakaHlsCreateSegments
        ) {
          const nativeHlsParserSupported = global.isNativeHlsParserSupported(
            playerName,
            playerVersion,
          );
          if (nativeHlsParserSupported) {
            console.log('shaka: setting native functions');
            shaka.hls.HlsParser.setNativeFunctions(this.nativeParsePlaylist);
          } else {
            console.log(
              'shaka: nativeHlsParser not supported for player version',
            );
          }
        } else {
          console.log(
            'shaka: native func not set even after register, skipping it',
          );
        }
      } else {
        console.log(
          `shakaplayer: native offload not enabled!registerNativePlayerUtils: ${!!global.registerNativePlayerUtils},setNativeFunctions: ${!!shaka
            .hls.HlsParser.setNativeFunctions}`,
        );
      }
    } else {
      console.log('shaka: native playlist parsing is disabled');
    }

    // Native XML parsing setup for DASH content
    if (ShakaPlayer.enableNativeXmlParsing) {
      if (
        global.registerNativePlayerUtils &&
        shaka.util.XmlUtils.setNativeFunctions
      ) {
        if (!global.isNativeXmlParserSupported) {
          console.log('shaka: isNativeXmlParserSupported not registered.');
        }
        if (global.isNativeXmlParserSupported && global.nativeParseFromString) {
          const isNativeXmlParserSupported = global.isNativeXmlParserSupported(
            playerName,
            playerVersion,
          );
          if (isNativeXmlParserSupported) {
            console.log('shaka: setting DASH native functions');
            shaka.util.XmlUtils.setNativeFunctions(this.nativeParseFromString);
          } else {
            console.log(
              'shaka: nativeXMLParser not supported for player version',
            );
          }
        } else {
          console.log(
            'shaka: native func not set even after register, skipping it',
          );
        }
      } else {
        console.log(
          `shakaplayer: DASH native offload not enabled!registerNativePlayerUtils: ${!!global.registerNativePlayerUtils},DASH::setNativeFunctions: ${!!shaka
            .util.XmlUtils.setNativeFunctions}`,
        );
      }
    } else {
      console.log('shaka: native Xml playlist parsing is disabled');
    }

    shaka.polyfill.installAll();
    console.log('shakaplayer: unregistering scheme http and https');
    shaka.net.NetworkingEngine.unregisterScheme('http');
    shaka.net.NetworkingEngine.unregisterScheme('https');

    console.log('shakaplayer: registering scheme http and https');
    const httpFetchPluginSupported = shaka.net.HttpFetchPlugin.isSupported();
    console.log(`httpfetchplugin supported? ${httpFetchPluginSupported}`);

    shaka.net.NetworkingEngine.registerScheme(
      'http',
      shaka.net.HttpFetchPlugin.parse,
      shaka.net.NetworkingEngine.PluginPriority.APPLICATION,
      true,
    );

    shaka.net.NetworkingEngine.registerScheme(
      'https',
      shaka.net.HttpFetchPlugin.parse,
      shaka.net.NetworkingEngine.PluginPriority.APPLICATION,
      true,
    );

    console.log('shakaplayer: creating');
    this.player = new shaka.Player(this.mediaElement);
    console.log('shakaplayer: loading');

    // Registering the Custom filters for uplynk test streams.
    const netEngine = this.player.getNetworkingEngine();
    netEngine.clearAllRequestFilters();
    netEngine.clearAllResponseFilters();
    netEngine.registerRequestFilter(this.uplynkRequestFilter);
    netEngine.registerResponseFilter(this.uplynkResponseFilter);

    if (
      this.setting_.hlsResumePositionSeconds &&
      this.setting_.hlsResumePositionSeconds > 0
    ) {
      let resumePlaylistTrimmed = false;
      netEngine.registerResponseFilter((type, response) => {
        if (
          resumePlaylistTrimmed ||
          type !== shaka.net.NetworkingEngine.RequestType.MANIFEST ||
          !response?.data
        ) {
          return;
        }

        try {
          const body = new TextDecoder('utf-8').decode(response.data);
          const trimmed = trimHlsMediaPlaylistForResume(
            body,
            this.setting_.hlsResumePositionSeconds!,
          );
          if (!trimmed) {
            return;
          }

          response.data = new Uint8Array(
            Array.from(trimmed.playlist).map((character) =>
              character.charCodeAt(0),
            ),
          ).buffer;
          resumePlaylistTrimmed = true;
          console.info('[Astra] Trimmed Jellyfin HLS resume playlist:', {
            skippedDurationSeconds: trimmed.skippedDurationSeconds,
            skippedSegments: trimmed.skippedSegments,
          });
        } catch (error) {
          console.warn('[Astra] Unable to trim HLS resume playlist:', error);
        }
      });
    }

    // This filter is needed for Axinom streams.
    if (content.hasOwnProperty('drm_license_header')) {
      let header_map: Map<string, string> = new Map();

      content.drm_license_header.map((values) => {
        console.log(
          `sample:shaka: got License header TAG: ${values[0]} DATA: ${values[1]}`,
        );
        header_map.set(values[0] as string, values[1] as string);
      });

      const filter = (
        type: shaka.net.NetworkingEngine.RequestType,
        request: shaka.extern.Request,
      ): void => {
        return this.addLicenseRequestHeaders_(header_map, type, request);
      };
      netEngine.registerRequestFilter(filter);
    }

    if (content.hasOwnProperty('manifest_header')) {
      let header_map: Map<string, string> = new Map();

      content.manifest_header.map((values) => {
        console.log(
          `sample:shaka: got Manifest header TAG: ${values[0]} DATA: ${values[1]}`,
        );
        header_map.set(values[0] as string, values[1] as string);
      });

      const filter = (
        type: shaka.net.NetworkingEngine.RequestType,
        request: shaka.extern.Request,
      ): void => {
        return this.addManifestRequestHeaders_(header_map, type, request);
      };
      netEngine.registerRequestFilter(filter);
    }
    // Need capabilities query support on native side about max
    // resolution supported by native side and dynamically
    // populate 'Max resolution' setting for ABR.
    if (!Platform.isTV) {
      console.log(
        'shakaplayer: For non-TV devices, max resolution is capped to FHD.',
      );
      this.setting_.abrMaxWidth = Math.min(
        1919,
        this.setting_.abrMaxWidth as number,
      );
      this.setting_.abrMaxHeight = Math.min(
        1079,
        this.setting_.abrMaxHeight as number,
      );
    }

    console.log(
      `ABR Max Resolution: ${this.setting_.abrMaxWidth} x ${this.setting_.abrMaxHeight}`,
    );

    const playerConfig: any = {
      streaming: {
        lowLatencyMode: false,
        inaccurateManifestTolerance: 0,
        // A near-zero rebuffer threshold causes one-second play/buffer loops
        // on high-bitrate HLS after a seek or track switch. Keep enough media
        // queued for stable restart without overcommitting this 1 GB device.
        rebufferingGoal: 2,
        bufferingGoal: 10,
        alwaysStreamText: true,
        retryParameters: {
          maxAttempts: 3,
        },
      },
      manifest: {
        dash: {
          disableXlinkProcessing: true,
        },
        hls: {
          // Vega's MP4 demuxer can pass overlapping decode timestamps from
          // adjacent Jellyfin fMP4 fragments through to the hardware decoder.
          // Sequence mode places each fragment directly after the previous
          // one, avoiding the repeated/backward DTS at fragment boundaries.
          // Callers opt in because cleartext music also shares this player.
          sequenceMode: this.setting_.hlsSequenceMode ?? false,
          // In segments mode, Jellyfin's fMP4 media timestamps are more
          // trustworthy than Shaka's duration-derived correction on Vega.
          // Opting in prevents large timestampOffset adjustments while still
          // retaining the source's natural audio/video cadence.
          ignoreManifestTimestampsInSegmentsMode:
            this.setting_.hlsIgnoreManifestTimestampsInSegmentsMode ?? false,
        },
      },
      abr: {
        enabled: this.setting_.abrEnabled,
        restrictions: {
          minWidth: 320,
          minHeight: 240,
          maxWidth: this.setting_.abrMaxWidth,
          maxHeight: this.setting_.abrMaxHeight,
        },
      },
      autoShowText: shaka.config.AutoShowText.ALWAYS,
    };

    if (content.vcodec) {
      playerConfig.preferredVideoCodecs = [content.vcodec];
    }
    if (content.acodec) {
      playerConfig.preferredAudioCodecs = [content.acodec];
    }

    this.player.configure(playerConfig);

    // Separating the drm configuration since Shaka seems to call drm operations even if they are not needed when drm configuration is present.
    if (content.drm_scheme !== null && content.drm_scheme !== '') {
      console.log(
        `shakaplayer: loading with ${content.drm_scheme} and ${content.drm_license_uri} and ${content.secure}`,
      );
      let signal_secure: string = 'SW_SECURE_CRYPTO';
      let audio_not_secure: string = 'SW_SECURE_CRYPTO';
      if (content.drm_scheme === 'com.microsoft.playready') {
        signal_secure = '150';
      }

      if (content.secure === 'true') {
        if (content.drm_scheme === 'com.microsoft.playready') {
          signal_secure = '3000';
        } else {
          signal_secure = 'HW_SECURE_ALL';
        }
      }

      console.log(
        `shakaplayer: loading with ${content.drm_scheme} and ${content.drm_license_uri} and ${signal_secure}`,
      );

      // For some reason, shaka does not like to use drm_scheme as a key for the map passed as object to configure call.
      // We are forced to create the map and then pass to configure call as in below.
      let server_map: Map<string, string> = {};
      server_map[content.drm_scheme as string] =
        content.drm_license_uri as string;
      this.player.configure('drm.servers', server_map);

      this.player.configure({
        drm: {
          advanced: {
            'com.widevine.alpha': {
              videoRobustness: signal_secure,
              audioRobustness: audio_not_secure,
              persistentStateRequired: false,
            },
            'com.microsoft.playready': {
              videoRobustness: signal_secure,
              audioRobustness: audio_not_secure,
              persistentStateRequired: false,
            },
          },
          preferredKeySystems: [content.drm_scheme],
        },
      });
    }

    await this.internalLoad(content);
    await this.waitForAppendComplete();
    console.log('shakaplayer: load() OUT');
  }
  private async internalLoad(content: any) {
    await this.player.load(content.uri, content.startTime);
    console.log('shakaplayer: setTextTrackVisibility');
    this.player.setTextTrackVisibility(true);
    console.log('shakaplayer: loaded');
  }
  play(): void {
    this.mediaElement?.play();
  }
  pause(): void {
    this.mediaElement?.pause();
  }
  async seekBack(): Promise<void> {
    if (this.bufferOperations.hasPendingOperations()) {
      await this.waitForAppendComplete();
    }
    const mediaElement = this.mediaElement;
    if (!mediaElement) {
      return;
    }
    const time = mediaElement.currentTime;
    console.log('shakaplayer: seekBack to ', time - 10);
    if (this.mediaElement === mediaElement) {
      mediaElement.currentTime = time - 10;
    }
  }
  async seekFront(): Promise<void> {
    if (this.bufferOperations.hasPendingOperations()) {
      await this.waitForAppendComplete();
    }
    const mediaElement = this.mediaElement;
    if (!mediaElement) {
      return;
    }
    const time = mediaElement.currentTime;
    console.log('shakaplayer: seekFront to ', time + 10);
    if (this.mediaElement === mediaElement) {
      mediaElement.currentTime = time + 10;
    }
  }

  getDebugStats() {
    if (!this.player) {
      return undefined;
    }

    try {
      const activeVariant = this.player
        .getVariantTracks?.()
        ?.find((track: {active?: boolean}) => track.active);

      return {
        activeVariant,
        buffered: this.player.getBufferedInfo?.(),
        stats: this.player.getStats?.(),
      };
    } catch (error) {
      console.warn('[Astra] Unable to read Shaka diagnostics:', error);
      return undefined;
    }
  }

  async unload(): Promise<void> {
    return this.enqueueLifecycle(() => this.unloadInternal());
  }

  private async unloadInternal(): Promise<void> {
    console.log('shakaplayer:unload');

    const player = this.player;
    this.player = null;
    this.mediaElement = null;

    await this.waitForAppendComplete();

    if (!player) {
      this.appendHooksCleanup?.();
      return;
    }

    // Clean up native XML parser if enabled
    if (
      ShakaPlayer.enableNativeXmlParsing &&
      global.isNativeXmlParserSupported &&
      global.nativeParseFromString &&
      global.unloadNativeXmlParser
    ) {
      const isNativeXmlParserSupported = global.isNativeXmlParserSupported(
        playerName,
        playerVersion,
      );
      if (isNativeXmlParserSupported) {
        console.log('shakaplayer: unloading native Xml parser');
        global.unloadNativeXmlParser();
        console.log('shakaplayer: unloaded native Xml parser');
      }
    }

    try {
      await player.detach();
    } finally {
      try {
        // Shaka cleanup is asynchronous. Awaiting destroy is essential before
        // another player attaches to the same Vega media element.
        await player.destroy();
      } finally {
        this.appendHooksCleanup?.();
      }
    }
  }
}
