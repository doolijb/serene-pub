cmake_minimum_required(VERSION 3.10)
project(serene_pub_node)

set(CMAKE_CXX_STANDARD 14)

# libnode.so + headers are pulled from the nodejs-mobile-react-native npm
# package by scripts/build-android.js (not committed — see .gitignore) into
# this same directory, matching the layout of that package's own android/
# folder so this CMakeLists can be a near-direct adaptation of theirs.
include_directories(${CMAKE_SOURCE_DIR}/libnode/include/node)

add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES
    IMPORTED_LOCATION ${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so
)

add_library(node-bridge SHARED node-bridge.cpp)

# Android 15+ devices can use 16 KB memory pages; a PT_LOAD segment whose
# p_align is only the old 4 KB default can fail to map cleanly (or at all) on
# those devices. This explicit flag guarantees 16 KB-aligned segments for our
# own library regardless of the NDK's default, on any sufficiently recent lld.
target_link_options(node-bridge PRIVATE "-Wl,-z,max-page-size=16384")

find_library(log-lib log)

target_link_libraries(node-bridge libnode ${log-lib})
