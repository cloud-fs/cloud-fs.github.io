CloudDrive2
==========

Clouddrive2 mounts cloud storage services as local file system.

Supported Cloud Storages
------------------------

*   115.com
*   cloud.189.cn
*   ~~wocloud.com.cn~~
*   aliyundrive.com
*   WebDAV
*   mypikpak.com
*   ...

Supported Architectures
| Architecture  |      Tag     |
|----------|:-------------:|
| x86-64 |  amd64 |
| arm64 |    arm64   |
|armv7| arm32|


Usage
=====

Before run
----------

Clouddrive2 uses fuse3 to mount cloud storages, to enable fuse in docker container and share fuse mounts to host, one of the following options should be set in host:

### Option 1: enable MountFlags in docker service

    
    #mkdir -p /etc/systemd/system/docker.service.d/
    #cat <<EOF > /etc/systemd/system/docker.service.d/clear_mount_propagation_flags.conf
    [Service]
    MountFlags=shared
    EOF
    

### Option 2: enable shared mount option for mapped volume in host

    
    #mount --make-shared <volume contains the path to accept cloud mounts>
    

Docker-compose
--------------

    
    ----
    version: "2.1"
    services:
      cloudnas:
        image: cloudnas/clouddrive2
        container_name: clouddrive2
        environment:
           - TZ=Asia/Shanghai
           - CLOUDDRIVE_HOME=/Config
        volumes:
          - <path to accept cloud mounts>:/CloudNAS:shared
          - <path to app data>:/Config
          - <other local shared path>:/media:shared #optional media path of host
        devices:
          - /dev/fuse:/dev/fuse
        restart: unless-stopped
        pid: "host"
        privileged: true #or you can try capp_add -SYS_ADMIN
        #cap_add: #SYS_ADMIN cap may fail on some OSes, use privileged: true instead
        # - SYS_ADMIN
        network_mode: "host" #if network_mode doesn't work, use port mapping
        #ports:
        #   - 19798:19798
    
    


    

docker cli
----------

    
    docker run -d \
          --name clouddrive \
          --restart unless-stopped \
          --env CLOUDDRIVE_HOME=/Config \
          -v <path to accept cloud mounts>:/CloudNAS:shared \
          -v <path to app data>:/Config \
          -v <other local shared path>:/media:shared \
          --network host \
          --pid host \
         --privileged \
         --device /dev/fuse:/dev/fuse \
         cloudnas/clouddrive2
    

Configuration
----------

    
    http://<ip>:19798
