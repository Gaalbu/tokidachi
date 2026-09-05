UUID := tokidachi@gaalbu.github.io
NATIVE := target/tokidachi

.PHONY: test jar native package install uninstall clean

test:
	mvn test
	node --check $(UUID)/extension.js
	node --check $(UUID)/i18n.js
	node --experimental-default-type=module --test tests/i18n.test.js
	node --experimental-default-type=module --test tests/provider-model.test.js
	node --test tests/ui-source.test.js
	node --test tests/branding.test.js
	node --experimental-default-type=module --import ./tests/harness/register.mjs \
		--test tests/extension-behavior.test.js
	./scripts/gjs-test.sh
	bash -n scripts/install.sh scripts/uninstall.sh scripts/package.sh

jar:
	mvn package

native:
	mvn -Pnative package

package: native
	./scripts/package.sh $(NATIVE)

install: native
	./scripts/install.sh

uninstall:
	./scripts/uninstall.sh

clean:
	mvn clean
	rm -rf build dist
