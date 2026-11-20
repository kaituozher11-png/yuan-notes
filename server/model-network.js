import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import net from 'node:net';
import { Agent, EnvHttpProxyAgent } from 'undici';

const registryKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
let proxyAgent;
let publicAgent;

export function publicModelAddress(address) {
  if (net.isIP(address) !== 4) return false;
  const [first, second, third] = address.split('.').map(Number);
  return first >= 1 && first <= 223 && first !== 10 && first !== 127 &&
    !(first === 100 && second >= 64 && second <= 127) &&
    !(first === 169 && second === 254) &&
    !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && (second === 168 || (second === 0 && third <= 2))) &&
    !(first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) &&
    !(first === 203 && second === 0 && third === 113);
}

export function publicModelDispatcher() {
  if (publicAgent) return publicAgent;
  publicAgent = new Agent({ connect: { lookup(hostname, options, callback) {
    dns.lookup(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error);
      const candidates = addresses.filter((item) => publicModelAddress(item.address));
      if (!candidates.length) return callback(new Error('模型接口不能指向内网地址'));
      return options?.all ? callback(null, candidates) : callback(null, candidates[0].address, candidates[0].family);
    });
  } } });
  return publicAgent;
}

function registryValue(name) {
  try {
    const output = execFileSync('reg', ['query', registryKey, '/v', name], {
      encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'm'))?.[1].trim();
  } catch {
    return null;
  }
}

function proxyUrl(value) {
  if (!value) return null;
  const candidate = /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseWindowsProxy(value) {
  if (!value) return null;
  if (!value.includes('=')) {
    const proxy = proxyUrl(value);
    return proxy ? { httpProxy: proxy, httpsProxy: proxy } : null;
  }
  const entries = Object.fromEntries(value.split(';').map((part) => part.trim().split('=')));
  const httpProxy = proxyUrl(entries.http);
  const httpsProxy = proxyUrl(entries.https || entries.http);
  return httpProxy || httpsProxy ? { httpProxy, httpsProxy } : null;
}

export function modelDispatcher(url) {
  if (['localhost', '127.0.0.1'].includes(new URL(url).hostname)) return undefined;
  if (proxyAgent) return proxyAgent;

  const hasEnvProxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].some((name) => process.env[name]);
  let options = null;
  if (hasEnvProxy) options = {};
  else if (process.platform === 'win32' && registryValue('ProxyEnable') === '0x1') {
    options = parseWindowsProxy(registryValue('ProxyServer'));
    if (options) options.noProxy = registryValue('ProxyOverride')?.replaceAll(';', ',') || '';
  }
  if (options) proxyAgent = new EnvHttpProxyAgent(options);
  return proxyAgent;
}
