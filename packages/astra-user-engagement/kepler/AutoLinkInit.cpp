#include "turbo-modules/AstraUserEngagement.h"

#include <Kepler/turbomodule/KeplerTurboModuleRegistration.h>

extern "C" {
__attribute__((visibility("default"))) void
autoLinkKeplerTurboModulesV1() noexcept {
    using namespace astra;
    KEPLER_REGISTER_TURBO_MODULE(AstraUserEngagement);
}
}
