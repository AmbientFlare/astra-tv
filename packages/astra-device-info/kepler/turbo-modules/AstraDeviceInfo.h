#ifndef ASTRA_DEVICE_INFO_H
#define ASTRA_DEVICE_INFO_H

#include "Kepler/turbomodule/KeplerTurboModule.h"
#include <apmf/iface/com/amazon/kepler/identifiers/IIdentifiers.h>
#include <apmf/ptr.h>

#include <string>

#define TM_API_NAMESPACE com::amazon::kepler::turbomodule

namespace astra {
class AstraDeviceInfo : public TM_API_NAMESPACE::KeplerTurboModule {
public:
    AstraDeviceInfo();
    ~AstraDeviceInfo() override = default;

    void aggregateMethods(
        TM_API_NAMESPACE::MethodAggregator<TM_API_NAMESPACE::KeplerTurboModule>&
            methodAggregator) const noexcept override;

    // Returns the device's friendly name, or an empty string when the
    // Identifiers component is unavailable. Callers supply the fallback.
    std::string getFriendlyDeviceName();

private:
    apmf::Ptr<apmf::iface::com::amazon::kepler::identifiers::IIdentifiers>
        identifiers;
};
}

#endif
