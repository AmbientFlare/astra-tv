// @ts-nocheck
/*
 * Copyright 2022-2024 Amazon.com, Inc. or its affiliates. All rights reserved.
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

import {debugLog} from '../../utils/logger';

declare global {
  namespace globalThis {
    var gmedia: any;
    var document: any;
  }
}

class Document {
  createElement = (name: string) => {
    debugLog(`document.createElement ${name}`);
    return global.gmedia;
  };
  getElementsByTagName = (name: string) => {
    debugLog(`document.getElementsByTagName ${name}`);
    return global.gmedia;
  };
  static install() {
    debugLog('Installing Document polyfill');
    global.document = new Document();
  }
}

export default Document;
