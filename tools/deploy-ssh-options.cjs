/**
 * deploy 脚本里 ssh/scp 共用：压低 OpenSSH 9+ 非后量子 KEX 等 stderr 提示。
 * 见 https://openssh.com/pq.html
 */
const SSH_QUIET_OPTS = [
  '-o',
  'LogLevel=QUIET',
  '-o',
  'ConnectTimeout=90',
  '-o',
  'ServerAliveInterval=30',
  '-o',
  'ServerAliveCountMax=6',
];

function withSshOpts(args) {
  return [...SSH_QUIET_OPTS, ...args];
}

module.exports = { SSH_QUIET_OPTS, withSshOpts };
