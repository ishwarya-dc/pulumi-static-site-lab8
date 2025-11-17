import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as synced_folder from "@pulumi/synced-folder";

// -----------------------------------------------------------------------------
// ⭐ ESC OIDC AWS Provider – GitHub Actions will supply AWS creds via OIDC
// -----------------------------------------------------------------------------
const escAwsProvider = new aws.Provider("escAwsProvider", {
    region: "us-east-1",
});

// -----------------------------------------------------------------------------
// ⭐ Read Pulumi config
// -----------------------------------------------------------------------------
const config = new pulumi.Config();
const path = config.get("path") || "./www";
const indexDocument = config.get("indexDocument") || "index.html";
const errorDocument = config.get("errorDocument") || "error.html";

// -----------------------------------------------------------------------------
// ⭐ S3 Bucket
// -----------------------------------------------------------------------------
const bucket = new aws.s3.BucketV2(
    "bucket",
    {},
    { provider: escAwsProvider }
);

// -----------------------------------------------------------------------------
// ⭐ S3 Website Configuration
// -----------------------------------------------------------------------------
const bucketWebsite = new aws.s3.BucketWebsiteConfigurationV2(
    "bucketWebsite",
    {
        bucket: bucket.bucket,
        indexDocument: { suffix: indexDocument },
        errorDocument: { key: errorDocument },
    },
    { provider: escAwsProvider }
);

// -----------------------------------------------------------------------------
// ⭐ S3 Ownership Controls
// -----------------------------------------------------------------------------
const ownershipControls = new aws.s3.BucketOwnershipControls(
    "ownership-controls",
    {
        bucket: bucket.bucket,
        rule: { objectOwnership: "ObjectWriter" },
    },
    { provider: escAwsProvider }
);

// -----------------------------------------------------------------------------
// ⭐ Public Access Block
// -----------------------------------------------------------------------------
const publicAccessBlock = new aws.s3.BucketPublicAccessBlock(
    "public-access-block",
    {
        bucket: bucket.bucket,
        blockPublicAcls: false, // required for public website hosting
    },
    { provider: escAwsProvider }
);

// -----------------------------------------------------------------------------
// ⭐ Upload static website files using Synced Folder
// -----------------------------------------------------------------------------
const bucketFolder = new synced_folder.S3BucketFolder(
    "bucket-folder",
    {
        path: path,
        bucketName: bucket.bucket,
        acl: "public-read",
    },
    {
        dependsOn: [ownershipControls, publicAccessBlock],
        provider: escAwsProvider,
    }
);

// -----------------------------------------------------------------------------
// ⭐ CloudFront CDN
// -----------------------------------------------------------------------------
const cdn = new aws.cloudfront.Distribution(
    "cdn",
    {
        enabled: true,
        origins: [
            {
                originId: bucket.arn,
                domainName: bucketWebsite.websiteEndpoint,
                customOriginConfig: {
                    originProtocolPolicy: "http-only",
                    httpPort: 80,
                    httpsPort: 443,
                    originSslProtocols: ["TLSv1.2"],
                },
            },
        ],
        defaultCacheBehavior: {
            targetOriginId: bucket.arn,
            viewerProtocolPolicy: "redirect-to-https",
            allowedMethods: ["GET", "HEAD", "OPTIONS"],
            cachedMethods: ["GET", "HEAD", "OPTIONS"],
            defaultTtl: 600,
            maxTtl: 600,
            minTtl: 600,
            forwardedValues: {
                queryString: true,
                cookies: { forward: "all" },
            },
        },
        priceClass: "PriceClass_100",
        customErrorResponses: [
            {
                errorCode: 404,
                responseCode: 404,
                responsePagePath: `/${errorDocument}`,
            },
        ],
        restrictions: {
            geoRestriction: {
                restrictionType: "none",
            },
        },
        viewerCertificate: {
            cloudfrontDefaultCertificate: true,
        },
    },
    { provider: escAwsProvider }
);

// -----------------------------------------------------------------------------
// ⭐ Outputs
// -----------------------------------------------------------------------------
export const originURL = pulumi.interpolate`http://${bucketWebsite.websiteEndpoint}`;
export const originHostname = bucketWebsite.websiteEndpoint;

export const cdnURL = pulumi.interpolate`https://${cdn.domainName}`;
export const cdnHostname = cdn.domainName;
