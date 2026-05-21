include $(TOPDIR)/rules.mk

PKG_NAME:=fn-knock
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_MAINTAINER:=fn-knock team

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/fn-knock
  SECTION:=net
  CATEGORY:=Network
  TITLE:=fn-knock - DDNS + SSL + Reverse Proxy Gateway
  URL:=https://github.com/1823774778/fn-knock-openwrt
  DEPENDS:=+node +redis-server +iptables
endef

define Package/fn-knock/description
  敲门knock OpenWrt 原生移植版本
  集DDNS动态域名、SSL证书自动化、反向代理、安全网关于一体的公网服务管理工具
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./dist $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(info fn-knock: pre-built dist mode, skipping source compilation)
	touch $(PKG_BUILD_DIR)/.built
endef

define Package/fn-knock/conffiles
/etc/config/fn-knock
endef

define Package/fn-knock/install
	$(INSTALL_DIR) $(1)/opt/fn-knock/server/server-admin
	$(CP) $(PKG_BUILD_DIR)/dist/server-admin/* $(1)/opt/fn-knock/server/server-admin/

	$(INSTALL_DIR) $(1)/opt/fn-knock/ui/www
	$(CP) $(PKG_BUILD_DIR)/dist/ui/* $(1)/opt/fn-knock/ui/www/

	$(INSTALL_DIR) $(1)/opt/fn-knock/server-auth-view/dist
	$(CP) $(PKG_BUILD_DIR)/dist/auth-view/* $(1)/opt/fn-knock/server-auth-view/dist/

	$(INSTALL_DIR) $(1)/opt/fn-knock/resources
	-$(CP) $(PKG_BUILD_DIR)/dist/resources/acmesh.zip $(1)/opt/fn-knock/resources/

	$(INSTALL_DIR) $(1)/usr/lib/fn-knock/bin
	-$(CP) $(PKG_BUILD_DIR)/dist/go-reauth-proxy $(1)/usr/lib/fn-knock/bin/go-reauth-proxy
	-chmod +x $(1)/usr/lib/fn-knock/bin/go-reauth-proxy

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/fn-knock $(1)/etc/init.d/fn-knock

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/fn-knock $(1)/etc/config/fn-knock

	$(INSTALL_DIR) $(1)/usr/lib/fn-knock
	echo "$(PKG_VERSION)-$(PKG_RELEASE)" > $(1)/usr/lib/fn-knock/version

	$(INSTALL_DIR) $(1)/var/lib/fn-knock
	$(INSTALL_DIR) $(1)/var/log/fn-knock
endef

define Package/fn-knock/preinst
#!/bin/sh
if ! id -u fn-knock >/dev/null 2>&1; then
	useradd -r -s /bin/false fn-knock
fi
endef

define Package/fn-knock/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0

chown -R fn-knock:fn-knock /var/lib/fn-knock /var/log/fn-knock

if [ -x /etc/init.d/fn-knock ]; then
	/etc/init.d/fn-knock enable
	/etc/init.d/fn-knock start
fi
endef

define Package/fn-knock/prerm
#!/bin/sh
if [ -x /etc/init.d/fn-knock ]; then
	/etc/init.d/fn-knock stop
	/etc/init.d/fn-knock disable
fi
endef

$(eval $(call BuildPackage,fn-knock))