#include "AstraUserEngagement.h"

#include <apmf/iface/com/amazon/kepler/user_engagement/IKeplerUserEngagementModuleV2.h>
#include <apmf/process.h>
#include <apmf/string_view.h>
#include <malloc.h>

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
    methodAggregator.addMethod(
        "releaseFreedMemory",
        0,
        &AstraUserEngagement::releaseFreedMemory);
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

// glibc keeps memory the app has freed in its per-thread arenas instead of
// handing it back, and the stick's memory manager still counts it. After
// playback that is ~120 MB, enough to make Astra the first app killed
// behind the screensaver. This returns the free pages to the system.
bool AstraUserEngagement::releaseFreedMemory() {
    return malloc_trim(0) != 0;
}
}
