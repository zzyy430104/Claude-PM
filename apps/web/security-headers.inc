# 安全响应头。nginx 中只要 location 里出现 add_header，就不会继承 server 级的 add_header，
# 所以每个设置了 add_header 的 location 都要 include 本文件。
# 样式用了 Angular Material 的内联样式，所以 style-src 需要 'unsafe-inline'；脚本不允许内联。
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "same-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
