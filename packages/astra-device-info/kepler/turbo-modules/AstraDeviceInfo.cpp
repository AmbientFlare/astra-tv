#include "AstraDeviceInfo.h"

#include <apmf/process.h>
#include <apmf/string.h>
#include <apmf/string_view.h>

using apmf::iface::com::amazon::kepler::identifiers::IIdentifiers;

namespace astra {
AstraDeviceInfo::AstraDeviceInfo()
    : TM_API_NAMESPACE::KeplerTurboModule("AstraDeviceInfo") {}

void AstraDeviceInfo::aggregateMethods(
    TM_API_NAMESPACE::MethodAggregator<TM_API_NAMESPACE::KeplerTurboModule>&
        methodAggregator) const noexcept {
    methodAggregator.addMethod(
        "getFriendlyDeviceName",
        0,
        &AstraDeviceInfo::getFriendlyDeviceName);
}

std::string AstraDeviceInfo::getFriendlyDeviceName() {
    // Without the run-time `device-friendly-name` privilege this returns the
    // device model name rather than any name the user has set. That is the
    // behaviour we want: a model name is still far more identifiable than a
    // hardcoded string, and it costs the user no consent dialog on first run.
    try {
        if (identifiers == nullptr) {
            static constexpr apmf::StringView component{
                "/com.amazon.kepler.identifiers"};
            identifiers = apmf::GetProcessObject()
                              ->getComponent(component)
                              .TryQueryInterface<IIdentifiers>();
            if (identifiers == nullptr) {
                return {};
            }
        }

        return static_cast<std::string>(identifiers->getFriendlyDeviceName());
    } catch (...) {
        return {};
    }
}
}
