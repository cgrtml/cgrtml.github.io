<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8" indent="yes"
    doctype-system="about:legacy-compat" />

  <xsl:template match="/rss/channel">
    <html lang="tr">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>RSS akışı &#183; <xsl:value-of select="title" /></title>
        <meta name="robots" content="noindex" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <style>
          :root {
            --navy:#1a2b4a; --link:#1f4e79; --link-hover:#0f2b48;
            --ink:#1c1c1e; --muted:#5b6470; --line:#e6e8ec;
            --bg:#ffffff; --bg-alt:#f7f8fa; --accent:#c08a2d;
            --serif:"Source Serif 4",Georgia,"Times New Roman",serif;
            --sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
          }
          *,*::before,*::after { box-sizing:border-box; }
          body { margin:0; font-family:var(--sans); font-size:17px; line-height:1.7;
                 color:var(--ink); background:var(--bg); -webkit-font-smoothing:antialiased; }
          a { color:var(--link); text-decoration:none; }
          a:hover { color:var(--link-hover); text-decoration:underline; text-underline-offset:2px; }
          .container { max-width:920px; margin:0 auto; padding:0 24px; }
          h1 { font-family:var(--serif); color:var(--navy); font-size:2.2rem;
               line-height:1.25; font-weight:600; margin:0 0 .3em; letter-spacing:-.01em; }
          h2 { font-family:var(--serif); color:var(--navy); font-size:1.55rem;
               font-weight:600; margin:0 0 .8em; }
          .lead { font-size:1.1rem; color:var(--muted); margin:0 0 1em; }
          .top { padding:44px 0 0; }
          .note { background:var(--bg-alt); border:1px solid var(--line); border-left:3px solid var(--accent);
                  border-radius:6px; padding:16px 20px; margin:24px 0 0; }
          .note p { margin:0 0 .6em; }
          .note p:last-child { margin:0; }
          .note code { font-size:.92rem; background:#fff; border:1px solid var(--line);
                       border-radius:4px; padding:2px 6px; overflow-wrap:anywhere; }
          .posts { padding:40px 0 56px; }
          .entry { border-top:1px solid var(--line); padding:22px 0 0; margin:0 0 22px; }
          .entry:first-child { border-top:none; padding-top:0; }
          .entry .title { font-family:var(--serif); font-size:1.22rem; font-weight:600;
                          line-height:1.3; margin:0 0 .3em; }
          .entry .meta { font-size:.9rem; color:var(--muted); margin:0 0 .5em; }
          .entry .desc { margin:0; color:var(--ink); }
          .back { border-top:1px solid var(--line); padding:22px 0 48px; font-size:.95rem; }
          @media (max-width:600px) { h1 { font-size:1.8rem; } body { font-size:16px; } }
        </style>
      </head>
      <body>
        <div class="container top">
          <h1><xsl:value-of select="title" /></h1>
          <p class="lead"><xsl:value-of select="description" /></p>
          <div class="note">
            <p><strong>Bu bir RSS akışıdır.</strong> Tarayıcılar için değil, akış okuyucuları için hazırlanmıştır. Tarayıcınız bu dosyayı tek başına gösteremediği için bu sayfa onu sizin yerinize biçimlendiriyor.</p>
            <p>Abone olmak için bu adresi Feedly, Inoreader ya da NetNewsWire gibi bir okuyucuya yapıştırın:<br />
              <code><xsl:value-of select="atom:link/@href" /></code></p>
          </div>
        </div>
        <div class="container posts">
          <h2>Son yazılar</h2>
          <xsl:for-each select="item">
            <div class="entry">
              <p class="title">
                <a><xsl:attribute name="href"><xsl:value-of select="link" /></xsl:attribute>
                  <xsl:value-of select="title" /></a>
              </p>
              <p class="meta"><xsl:value-of select="pubDate" /></p>
              <p class="desc"><xsl:value-of select="description" /></p>
            </div>
          </xsl:for-each>
        </div>
        <div class="container back">
          <a><xsl:attribute name="href"><xsl:value-of select="link" /></xsl:attribute>
            &#8592; Bloga dön</a>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
