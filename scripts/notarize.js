require('dotenv').config();

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') {
        return;
    }

    // Load ESM module dynamically because @electron/notarize v2+ is ESM only
    const { notarize } = await import('@electron/notarize');

    const appName = context.packager.appInfo.productFilename;

    // Gather credentials from env
    const appleId = process.env.APPLE_ID;
    const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;
    const teamId = process.env.APPLE_TEAM_ID;

    if (!appleId || !appleIdPassword || !teamId) {
        console.log("Notarization skipped: Missing credentials.");
        return;
    }

    console.log(`Notarizing ${appName} with Apple ID ${appleId} and Team ID ${teamId}...`);

    try {
        await notarize({
            appBundleId: "com.irtizanasar.ml-bridge",
            appPath: `${appOutDir}/${appName}.app`,
            appleId: appleId,
            appleIdPassword: appleIdPassword,
            teamId: teamId,
            tool: 'notarytool'
        });
        console.log(`Notarization successful for ${appName}`);
    } catch (error) {
        console.error("NOTARIZATION FAILED");
        console.error(error);
        // Exit process with failure to ensure CI fails
        process.exit(1);
    }
};
