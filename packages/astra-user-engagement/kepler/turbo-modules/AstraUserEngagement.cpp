#include "AstraUserEngagement.h"

#include <apmf/iface/com/amazon/kepler/user_engagement/IKeplerUserEngagementModuleV2.h>
#include <apmf/process.h>
#include <apmf/string_view.h>

using apmf::iface::com::amazon::kepler::user_engagement::
    IKeplerUserEngagementModuleV2;

namespace astra {
AstraUserEngagement::AstraUserEngagement()
    : TM_API_NAMESPACE::KeplerTurboModule("AstraUserEngagement") {}

AstraUserEngagement::~AstraUserEngagement() {
    stopVideoEngagement();
}

void AstraUserEngagement::aggregateMethods(
    TM_API_NAMESPACE::MethodAggregator<TM_API_NAMESPACE::KeplerTurboModule>&
        methodAggregator) const noexcept {
    methodAggregator.addMethod(
        "startVideoEngagement",
        0,
        &AstraUserEngagement::startVideoEngagement);
    methodAggregator.addMethod(
        "stopVideoEngagement",
        0,
        &AstraUserEngagement::stopVideoEngagement);
}

bool AstraUserEngagement::startVideoEngagement() {
    if (videoEngagementStarted) {
        return true;
    }

    try {
        if (videoEngagement == nullptr) {
            static constexpr apmf::StringView component{
                "/com.amazon.kepler.user_engagement.user_engagement_module"};
            auto module =
                apmf::GetProcessObject()
                    ->getComponent(component)
                    .TryQueryInterface<IKeplerUserEngagementModuleV2>();
            if (module == nullptr) {
                return false;
            }
            videoEngagement = module->makeVideoPlaybackUserEngagement();
        }

        videoEngagement->start();
        videoEngagementStarted = true;
        return true;
    } catch (...) {
        videoEngagementStarted = false;
        return false;
    }
}

bool AstraUserEngagement::stopVideoEngagement() {
    if (!videoEngagementStarted || videoEngagement == nullptr) {
        videoEngagementStarted = false;
        return true;
    }

    try {
        videoEngagement->stop();
        videoEngagementStarted = false;
        return true;
    } catch (...) {
        videoEngagementStarted = false;
        return false;
    }
}
}
