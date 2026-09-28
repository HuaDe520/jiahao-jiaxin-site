/* =========================================================
   阿里云 OSS 读写（只用内置 crypto 做签名，不装任何依赖）
   ---------------------------------------------------------
   整个数据库就是一个 JSON 对象，读到内存改完写回。
   协会这个规模（几十人、一天几条写入）完全够用。

   凭证有两种来源，按优先级：
     1) 环境变量 OSS_AK / OSS_SK（RAM 用户的 AccessKey）
     2) 函数计算给的角色临时凭证（context.credentials）
   ========================================================= */

import { createHmac, createHash } from 'node:crypto';

function gmtDate(d) {
  return d.toUTCString();
}

function sign({ method, bucket, key, contentType, md5, date, ossHeaders, ak, sk }) {
  const canonicalHeaders = Object.keys(ossHeaders)
    .map((k) => k.toLowerCase())
    .sort()
    .map((k) => `${k}:${ossHeaders[k]}\n`)
    .join('');
  const resource = `/${bucket}/${key}`;
  const stringToSign = [
    method,
    md5 || '',
    contentType || '',
    date,
    canonicalHeaders + resource,
  ].join('\n');
  const signature = createHmac('sha1', sk).update(stringToSign, 'utf8').digest('base64');
  return `OSS ${ak}:${signature}`;
}

export function createOssIo({ bucket, region, ak, sk, stsToken, key }) {
  const host = `${bucket}.${region}.aliyuncs.com`;

  function authHeaders(method, contentType, body, objKey) {
    const date = gmtDate(new Date());
    const md5 = body ? createHash('md5').update(body).digest('base64') : '';
    const ossHeaders = {};
    if (stsToken) ossHeaders['x-oss-security-token'] = stsToken;
    const headers = {
      Date: date,
      Authorization: sign({
        method, bucket, key: objKey || key, contentType, md5, date, ossHeaders, ak, sk,
      }),
    };
    if (md5) headers['Content-MD5'] = md5;
    if (contentType) headers['Content-Type'] = contentType;
    Object.assign(headers, ossHeaders);
    return headers;
  }

  async function read() {
    const headers = authHeaders('GET', '', null);
    const res = await fetch(`https://${host}/${key}`, { method: 'GET', headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OSS 读取失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.text();
  }

  async function write(text) {
    const body = Buffer.from(text, 'utf8');
    const headers = authHeaders('PUT', 'application/json', body);
    const res = await fetch(`https://${host}/${key}`, { method: 'PUT', headers, body });
    if (!res.ok) throw new Error(`OSS 写入失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  }

  /* ---- 二进制对象（头像）---- */
  async function putObject(objKey, bytes, contentType) {
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const headers = authHeaders('PUT', contentType || 'application/octet-stream', body, objKey);
    const res = await fetch(`https://${host}/${objKey}`, { method: 'PUT', headers, body });
    if (!res.ok) throw new Error(`OSS 上传失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  }

  async function getObject(objKey) {
    const headers = authHeaders('GET', '', null, objKey);
    const res = await fetch(`https://${host}/${objKey}`, { method: 'GET', headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OSS 读取失败 ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { bytes: buf, contentType: res.headers.get('content-type') || 'image/png' };
  }

  async function deleteObject(objKey) {
    const headers = authHeaders('DELETE', '', null, objKey);
    const res = await fetch(`https://${host}/${objKey}`, { method: 'DELETE', headers });
    return res.ok || res.status === 404;
  }

  return { read, write, putObject, getObject, deleteObject, host, key };
}
