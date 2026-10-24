# Android 壳补丁（ApiActivity）

`app/zeehowebnext.apk` 在原有 `MainActivity` 之外增加了一个轻量 `ApiActivity`，用于「接口调试台」快捷方式：

- 不再经过 `MainActivity` 的 `WebCache` 首次下载（弱网下会卡几秒到几十秒）；
- 直接 WebView 加载 `https://lswlc33.github.io/zeeho-3d-models/api.html`；
- 带加载进度圈，`onShowFileChooser` 支持壁纸上传的图片选择；
- 长按桌面图标 →「接口调试台」启动。

## 集成方式

1. 把 `ApiActivity.java` 放到壳工程的同名包 `io.github.lswlc33.zeehowebnext`；
2. `AndroidManifest.xml` 的 `<application>` 内加入：

```xml
<activity
    android:name=".ApiActivity"
    android:exported="true"
    android:launchMode="singleTask"
    android:configChanges="uiMode"
    android:screenOrientation="portrait"
    android:windowSoftInputMode="adjustResize" />
```

3. 把 `shortcuts.xml` 放到 `res/xml/`，并在 `MainActivity` 的 `<activity>` 内加：

```xml
<meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />
```

4. 字符串资源：

```xml
<string name="shortcut_api_short">接口调试台</string>
<string name="shortcut_api_long">打开极核接口调试台（车况 / OTA / 壁纸）</string>
```

## 构建/签名

当前仓库里的 APK 是**本地 debug 证书**签名的测试包；原包证书是 `CN=Zeeho Unlocker`，本仓库没有对应 keystore。发布前必须用原 keystore 重签并 bump `versionCode`，否则不能覆盖安装原包。

`ApiActivity` 先加载 fork Pages 的 `api.html`（PR 合并前可用），失败再回退 upstream；PR 合并后两边都可用。
