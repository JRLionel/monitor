-- CreateTable
CREATE TABLE "WechatAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "bizId" TEXT,
    "avatar" TEXT,
    "description" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'rss',
    "feedUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "baselineDone" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" DATETIME,
    "lastArticleAt" DATETIME,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextCheckAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WechatArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "digest" TEXT,
    "coverUrl" TEXT,
    "author" TEXT,
    "publishedAt" DATETIME,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WechatArticle_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WechatAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WechatAccount_feedUrl_key" ON "WechatAccount"("feedUrl");

-- CreateIndex
CREATE UNIQUE INDEX "WechatArticle_url_key" ON "WechatArticle"("url");

-- CreateIndex
CREATE INDEX "WechatArticle_accountId_publishedAt_idx" ON "WechatArticle"("accountId", "publishedAt");
