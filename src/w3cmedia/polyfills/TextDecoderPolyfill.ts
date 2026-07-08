// @ts-nocheck
/*
 * Copyright 2022-2025 Amazon.com, Inc. or its affiliates. All rights reserved.
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

class TextDecoderPolyfill {
  static install() {
    debugLog('Installing TextDecoder polyfill');
    global.window.TextDecoder = TextDecoder;
  }
}

export default TextDecoderPolyfill;
