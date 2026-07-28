cmake_minimum_required(VERSION 3.22)

project(AstraUserEngagement VERSION 1.0 LANGUAGES CXX C)

set(CMAKE_MODULE_PATH ${CMAKE_BINARY_DIR} ${CMAKE_MODULE_PATH})
set(CMAKE_PREFIX_PATH ${CMAKE_BINARY_DIR} ${CMAKE_PREFIX_PATH})
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Apmf REQUIRED)
find_package(Kepler REQUIRED)
find_package(turbomoduleAPI CONFIG REQUIRED)

kepler_add_idl_import_library(
  user_engagement_idl
  PACKAGES
  com.amazon.kepler.user_engagement
)

kepler_add_turbo_module_library(
  AstraUserEngagement
  SHARED
  kepler/turbo-modules/AstraUserEngagement.cpp
  kepler/turbo-modules/AstraUserEngagement.h
  kepler/AutoLinkInit.cpp
)

target_link_libraries(AstraUserEngagement PRIVATE user_engagement_idl)
install(TARGETS AstraUserEngagement)
