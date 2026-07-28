#ifndef ASTRA_USER_ENGAGEMENT_H
#define ASTRA_USER_ENGAGEMENT_H

#include "Kepler/turbomodule/KeplerTurboModule.h"
#include <apmf/iface/com/amazon/kepler/user_engagement/IUserEngagement.h>
#include <apmf/ptr.h>

#define TM_API_NAMESPACE com::amazon::kepler::turbomodule

namespace astra {
class AstraUserEngagement : public TM_API_NAMESPACE::KeplerTurboModule {
public:
    AstraUserEngagement();
    ~AstraUserEngagement() override;

    void aggregateMethods(
        TM_API_NAMESPACE::MethodAggregator<TM_API_NAMESPACE::KeplerTurboModule>&
            methodAggregator) const noexcept override;

    bool startVideoEngagement();
    bool stopVideoEngagement();

private:
    apmf::Ptr<apmf::iface::com::amazon::kepler::user_engagement::IUserEngagement>
        videoEngagement;
    bool videoEngagementStarted{false};
};
}

#endif
