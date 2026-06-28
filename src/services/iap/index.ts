import {readAppState, setProStatus} from '../storage';

/* global globalThis */

export const ASTRA_PRO_SKU = 'astra.pro';

type IapModule = Record<string, unknown>;

const getIapModule = (): IapModule | null => {
  try {
    const dynamicRequire = (
      globalThis as {require?: (name: string) => IapModule}
    ).require;

    return dynamicRequire?.('@amzn/keplerscript-appstore-iap-lib') ?? null;
  } catch {
    return null;
  }
};

const callIap = async <Response>(
  methodNames: string[],
  ...args: unknown[]
): Promise<Response | null> => {
  const iapModule = getIapModule();

  if (!iapModule) {
    return null;
  }

  for (const methodName of methodNames) {
    const method = iapModule[methodName];

    if (typeof method === 'function') {
      return (await method(...args)) as Response;
    }
  }

  return null;
};

const receiptOwnsSku = (receipt: unknown): boolean => {
  if (!receipt || typeof receipt !== 'object') {
    return false;
  }

  const receiptRecord = receipt as Record<string, unknown>;
  const sku =
    receiptRecord.sku ??
    receiptRecord.SKU ??
    receiptRecord.productId ??
    receiptRecord.productID;
  const status = receiptRecord.status ?? receiptRecord.receiptStatus;

  return (
    sku === ASTRA_PRO_SKU &&
    status !== 'CANCELED' &&
    status !== 'FAILED' &&
    status !== 'EXPIRED'
  );
};

const responseOwnsPro = (response: unknown): boolean => {
  if (!response) {
    return false;
  }

  if (Array.isArray(response)) {
    return response.some(receiptOwnsSku);
  }

  if (receiptOwnsSku(response)) {
    return true;
  }

  if (typeof response === 'object') {
    const responseRecord = response as Record<string, unknown>;

    return ['receipts', 'entitlements', 'purchases'].some((key) =>
      Array.isArray(responseRecord[key])
        ? (responseRecord[key] as unknown[]).some(receiptOwnsSku)
        : false,
    );
  }

  return false;
};

export const checkAstraProReceipt = async (): Promise<boolean> => {
  const response = await callIap<unknown>(
    [
      'getPurchaseUpdates',
      'getPurchases',
      'getPurchaseReceipts',
      'queryPurchases',
    ],
    false,
  );

  if (response === null) {
    return (await readAppState()).isPro;
  }

  const isPro = responseOwnsPro(response);

  await setProStatus(isPro);

  return isPro;
};

export const purchaseAstraPro = async (): Promise<boolean> => {
  const response = await callIap<unknown>(
    ['purchase', 'purchaseProduct', 'requestPurchase'],
    ASTRA_PRO_SKU,
  );
  const isPro = responseOwnsPro(response);

  if (isPro) {
    await setProStatus(true);
  }

  return isPro;
};

export const isIapAvailable = (): boolean => Boolean(getIapModule());
