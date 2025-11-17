import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as synced_folder from "@pulumi/synced-folder";

// --------------------------------------------------------
// 1️⃣ AWS Provider using ESC OIDC (credentials auto-injected)
// --------------------------------------------------------
const escAwsProvider = new aws.Provider("escAwsProvider", {
    region: "us-east-1",
});

// --------------------------------------------------------
// 2️⃣ Pulumi config for static site files
// --------------------------------------------------------
const config = new pulumi.Config();
const path = config.get("path") || "./www";
const indexDocument = config.get("indexDocument") || "index.html";
const errorDocument = config.get("errorDocument") || "error.html";

// --------------------------------------------------------
// 3️⃣ S3 Bucket
// --------------------------------------------------------
const bucket = new aws.s3.BucketV2("bucket", {}, { provider: escAwsProvider });

const bucketWebsite = new aws.s3.BucketWebsiteConfigurationV2("bucketWebsite", {
    bucket: bucket.bucket,
    indexDocument: { suffix: indexDocument },
    errorDocument: { key: errorDocument },
}, { provider: escAwsProvider });

const ownershipControls = new aws.s3.BucketOwnershipControls("ownershipControls", {
    bucket: bucket.bucket,
    rule: { objectOwnership: "ObjectWriter" },
}, { provider: escAwsProvider });

const publicAccessBlock = new aws.s3.BucketPublicAccessBlock("publicAccessBlock", {
    bucket: bucket.bucket,
    blockPublicAcls: false,
}, { provider: escAwsProvider });

// --------------------------------------------------------
// 4️⃣ Sync local folder to S3
// --------------------------------------------------------
const bucketFolder = new synced_folder.S3BucketFolder("bucketFolder", {
    path: path,
    bucketName: bucket.bucket,
    acl: "public-read",
}, {
    dependsOn: [ownershipControls, publicAccessBlock],
    provider: escAwsProvider,
});

// --------------------------------------------------------
// 5️⃣ CloudFront CDN
// --------------------------------------------------------
const cdn = new aws.cloudfront.Distribution("cdn", {
    enabled: true,
    origins: [{
        originId: bucket.arn,
        domainName: bucketWebsite.websiteEndpoint,
        customOriginConfig: {
            originProtocolPolicy: "http-only",
            httpPort: 80,
            httpsPort: 443,
            originSslProtocols: ["TLSv1.2"],
        },
    }],
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
    customErrorResponses: [{
        errorCode: 404,
        responseCode: 404,
        responsePagePath: `/${errorDocument}`,
    }],
    restrictions: {
        geoRestriction: { restrictionType: "none" },
    },
    viewerCertificate: { cloudfrontDefaultCertificate: true },
}, { provider: escAwsProvider });

// --------------------------------------------------------
// 6️⃣ Outputs
// --------------------------------------------------------
export const originHostname = bucketWebsite.websiteEndpoint;
export const originURL = pulumi.interpolate`http://${bucketWebsite.websiteEndpoint}`;
export const cdnHostname = cdn.domainName;
export const cdnURL = pulumi.interpolate`https://${cdn.domainName}`;
