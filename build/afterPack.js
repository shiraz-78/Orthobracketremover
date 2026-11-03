// The Mac builds are not signed with a developer certificate. Apple silicon refuses to start an app
// whose signature no longer matches its contents ("is damaged"), so give the packed app an ad-hoc
// signature. macOS then only asks once whether to open an app from an unidentified developer.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
