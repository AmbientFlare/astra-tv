// @ts-nocheck
/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates. All rights reserved.
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
import {debugLog} from '../../utils/logger';

// CustomDOMParser will try to use native xml parser
// provided by native-player-utils (sets property
// global.nativeParseFromString if available), if not found
// it will fallback to use xmldom's DOMParser
class CustomDOMParser extends DOMParser {
  constructor() {
    debugLog(`CustomDOMParser created`);
    super();
  }

  parseFromString(str: string, mimeType: string) {
    debugLog(`CustomDOMParser::parseFromString`);
    debugLog(
      `shaka: global.nativeParseFromString = ${!!global.nativeParseFromString}`,
    );
    if (global.nativeParseFromString) {
      // native xml parser available, can use native parsing
      debugLog(`nativeParseFromString available`);
      debugLog(`calling XmlUtils.nativeParseFromString, mime:`, mimeType);
      return global.nativeParseFromString(str);
    } else {
      // native xml parser not available, fallback and use xmldom
      debugLog(`nativeParseFromString not available`);
      debugLog(`calling DomParser's parseFromString`);
      return super.parseFromString(str, mimeType);
    }
  }
}

class DOMParserPolyfill {
  static install() {
    debugLog('Installing dom parser polyfills');
    if (typeof window !== 'undefined') {
      try {
        global.window.DOMParser = CustomDOMParser;
        global.DOMParser = CustomDOMParser;
        debugLog('Installed dom parser polyfills');
      } catch (e) {
        console.warn('Failed to install DOMParser polyfill:', e);
      }
    }
  }
}

export default DOMParserPolyfill;
