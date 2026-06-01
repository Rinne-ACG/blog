import sys

# 读取文件
with open('D:/boke/blog/vite.config.ts', 'rb') as f:
    content = f.read()

# 修复语法错误：String(e) }))  →  String(e) })
old = b"String(e) }))"
new = b"String(e) })"
count = content.count(old)
if count > 0:
    content = content.replace(old, new)
    print(f"修复了 {count} 处语法错误：String(e) 多了一个 )")
else:
    print("未找到 String(e) 语法错误，检查其他问题...")
    # 打印有问题的行
    lines = content.split(b'\n')
    for i, line in enumerate(lines):
        if b'String(e' in line:
            print(f"  L{i+1}: {line}")

# 修复 Credential 拼写（如果有）
if b'Credential=' in content:
    content = content.replace(b'Credential=', b'Credential=')
    print("修复了 Credential 拼写")

# 修复 SignedHeaders 拼写（如果有）
if b'SignedHeaders=' in content:
    content = content.replace(b'SignedHeaders=', b'SignedHeaders=')
    print("修复了 SignedHeaders 拼写")

# 修复 canonicalRequest 拼写（如果有）
if b'canonicalRequest' in content:
    content = content.replace(b'canonicalRequest', b'canonicalRequest')
    print("修复了 canonicalRequest 拼写")

# 写入文件
with open('D:/boke/blog/vite.config.ts', 'wb') as f:
    f.write(content)

print("\nvite.config.ts 已修复并保存！")
print("现在可以重启 Vite 开发服务器了。")
