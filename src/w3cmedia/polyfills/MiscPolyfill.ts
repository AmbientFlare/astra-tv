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
import { WebCrypto } from "@amazon-devices/react-native-w3cmedia/dist/headless";
import {decode/*, encode*/} from 'base-64';

class MiscPolyfill {
    static install() {
        console.log("Installing misc polyfills");
        global.navigator.userAgent = "AFTCA001";
        global.window.fetch = fetch;
        global.window.addEventListener = (type: any, listener: any, options?: any) => {
            console.log(`adding window listener ${type}`);
        }
        global.window.removeEventListener = (
          type: any,
          listener: any,
          options?: any
        ) => {
          console.log(`removing window listener ${type}`);
        };
        global.window.console = console;
        global.window.crypto = WebCrypto;
        global.window.atob = decode;
    }
}

export default MiscPolyfill;
